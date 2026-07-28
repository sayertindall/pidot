# Subagent Socket Transport — Spec

**Status**: Implemented (Phase 2a-c) · **Date**: 2025-07-27 · **Depends on**: session-control Phase 1 (done), pi-subagents (done)

## 1. Goal

Replace the stub `harness-pi-rpc.ts` with session-control socket transport.
`subagent()` spawns a child pi process via `interactive_shell`, communicates
over Unix sockets using the existing session-control RPC protocol, and receives
a typed `SubagentResult` via the `result_ready` event.

No new CLI mode. No stdio pipes. The child is a normal pi session — same code
path as every other session.

## 2. Current State

`harness-pi-rpc.ts` throws:

```
"harness: \"pi-rpc\" is specified but not yet implemented.
 Use harness: \"pi\" (in-process) or harness: \"interactive-shell\" instead."
```

The in-process harness (`session-runner.ts` → `createAgentSession`) works.
Subagents run inside the parent process. Crash isolation is zero — if the
subagent's model call throws an unhandled error, the parent session dies.

`session-control` Phase 1 is built. Sockets, RPC protocol, `send_to_session`
tool, `result_ready` event type — all compiles, not loaded in a live session yet.

## 3. Design

### 3.1 Spawn Flow

```
Parent: subagent({ agent: "finder", task: "locate auth code" })
  │
  ├─ 1. Resolve agent config (model, tools, thinking, system prompt)
  │
  ├─ 2. interactive_shell({
  │       spawn: { agent: "pi", mode: "fresh" },
  │       mode: "dispatch",
  │       background: true,
  │       name: `subagent-${agentName}-${runId.slice(0, 8)}`
  │     })
  │     → returns childSessionId
  │
  ├─ 3. Wait for socket: poll ~/.pi/agent/pi-toolkit/session-control/<childSessionId>.sock
  │     → 100ms interval, 10s timeout
  │     → isSocketAlive() confirms readiness
  │
  ├─ 4. Send task over socket:
  │     send_to_session({
  │       sessionId: childSessionId,
  │       message: buildSubagentPrompt(task, agentConfig),
  │       metadata: {
  │         kind: "subagent-task",
  │         runId,
  │         parentSessionId,
  │         agentName,
  │         agentConfig   // serialized AgentConfig for the child to use
  │       },
  │       wait_until: "result_ready"
  │     })
  │
  ├─ 5. Child receives send:
  │     → message-handler.ts detects metadata.kind === "subagent-task"
  │     → routes to subagent-runner.ts (NEW MODULE)
  │     → subagent-runner calls the existing runAgent() from session-runner.ts
  │     → agent runs, tools fire, turns complete
  │     → runner captures SubagentResult
  │     → emits result_ready event with SubagentResult payload
  │
  └─ 6. Parent receives result_ready:
      → SubagentResult in hand
      → wrapped as subagent() tool return value (same shape as today)
      → child process: killed (dispatch cleanup) or kept alive (pool mode)
```

### 3.2 New Module: subagent-runner.ts

Lives in `pi-toolkit/session-control/extensions/session-control/subagent-runner.ts`.

Single responsibility: when the session-control server receives a `send` with
`metadata.kind === "subagent-task"`, run an agent and emit the result.

```typescript
// subagent-runner.ts
export async function runSubagentTask(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  metadata: SubagentTaskMetadata,
  state: SocketState,
): Promise<void> {
  // 1. Deserialize agent config from metadata
  const agentConfig = metadata.agentConfig as AgentConfig;

  // 2. Run the agent using pi-subagents' runAgent()
  //    (same function the in-process harness uses today)
  const result = await runAgent(ctx, agentConfig.name, metadata.task, {
    agentConfig,
    cwd: ctx.cwd,
    configCwd: ctx.cwd,
    signal: ctx.signal ?? undefined,
  });

  // 3. Build SubagentResult
  const subagentResult: SubagentResult = {
    runId: metadata.runId,
    status: result.failure ? "failed" : (result.aborted ? "stopped" : "completed"),
    stoppedReason: result.aborted ? "turn-limit" : undefined,
    output: result.responseText,
    toolCount: 0,       // extract from session
    turnCount: 0,       // extract from session
    error: result.failure,
    agentName: agentConfig.name,
    modelUsed: agentConfig.model ?? "unknown",
  };

  // 4. Emit result_ready to all subscribers
  fireResultReadyEvents(state, subagentResult);

  // 5. Exit if this is a one-shot subagent (not a pool worker)
  if (metadata.lifecycle === "single") {
    ctx.shutdown();
  }
}
```

### 3.3 Message Handler Integration

In `message-handler.ts`, the `handleSend` function gains a pre-dispatch check:

```typescript
async function handleSend(pi, ctx, command, socket) {
  // NEW: subagent task interception
  if (command.metadata?.kind === "subagent-task") {
    await runSubagentTask(pi, ctx, command.metadata, state);
    respond(socket, command, true, { delivered: true, mode: "subagent-task" });
    return;
  }

  // Existing send logic unchanged
  const { message, mode, quiet } = command;
  // ...
}
```

### 3.4 pi-subagents Integration

In `pi-subagents/extensions/subagents/session-runner.ts`, a new harness:

```typescript
// socket-harness.ts
export async function runViaSocket(
  launch: SocketLaunchConfig,
): Promise<HarnessResult> {
  // 1. Spawn child via interactive_shell
  const spawnResult = await interactiveShellSpawn({
    spawn: { agent: "pi", mode: "fresh" },
    mode: "dispatch",
    background: true,
    name: `subagent-${launch.agentName}-${launch.runId.slice(0, 8)}`,
  });

  // 2. Wait for socket
  const socketPath = await waitForSocket(spawnResult.sessionId, 10_000);

  // 3. Send task
  const result = await sendRpcCommand(socketPath, {
    type: "send",
    message: launch.prompt,
    metadata: {
      kind: "subagent-task",
      runId: launch.runId,
      parentSessionId: launch.parentSessionId,
      agentName: launch.agentName,
      agentConfig: launch.agentConfig,
      lifecycle: launch.poolMode ? "pool" : "single",
    },
    mode: "steer",
  }, {
    timeout: launch.timeoutMs ?? 300_000,
    waitForEvent: "result_ready",
  });

  // 4. Return structured result
  return {
    responseText: (result.event as any)?.result?.output ?? "",
    status: (result.event as any)?.result?.status ?? "failed",
    // ... map to HarnessResult
  };
}
```

### 3.5 Harness Selection

In `session-runner.ts`, `runAgent()` gains a harness parameter:

```typescript
export async function runAgent(
  ctx, type, prompt, options,
): Promise<RunResult> {
  const harness = options.harness ?? "in-process";

  if (harness === "socket") {
    return runViaSocket({ ... });
  }

  // existing in-process logic unchanged
  // ...
}
```

The `subagent()` tool in `index.ts` defaults to `harness: "in-process"` for
backward compatibility. `harness: "socket"` is opt-in until proven stable,
then becomes the default.

## 4. What the Child Session Looks Like

The child is a normal pi process spawned by dispatch. It loads:
- `session-control` extension (socket + message handler)
- Whatever extensions the parent passed in `agentConfig.extensions`

It does NOT load:
- `pi-subagents` extension (subagents don't spawn sub-subagents)
- TUI-heavy extensions (no interactive mode needed)

The child's `session_start` hook creates the socket. The child waits for a
`send` command. On receiving `metadata.kind === "subagent-task"`, it runs the
agent. When done, it emits `result_ready` and (if `lifecycle: "single"`) exits.

## 5. Error Handling

| Failure | Parent sees |
|---|---|
| Child process fails to spawn | `interactive_shell` returns error, `subagent()` returns failed |
| Socket never appears (timeout) | `waitForSocket` throws after 10s, parent cleans up |
| Child crashes mid-task | Socket disconnects, `sendRpcCommand` throws ECONNRESET |
| Agent returns error | `SubagentResult.status: "failed"` with `error` field |
| Agent hits turn limit | `SubagentResult.status: "stopped"` with `stoppedReason: "turn-limit"` |
| Parent crashes | Child keeps running, writes result artifact (see persistence spec) |
| Timeout (5 min default) | `sendRpcCommand` timeout fires, parent kills child process |

## 6. What Ships

### New files

| File | Purpose |
|---|---|
| `pi-toolkit/session-control/extensions/session-control/subagent-runner.ts` | Run agent on receiving subagent-task metadata |
| `pi-subagents/extensions/subagents/socket-harness.ts` | Spawn child via dispatch, communicate over socket |
| `pi-subagents/extensions/subagents/ledger.ts` | Parent-side spawn tracking (persistence spec) |

### Changed files

| File | Change |
|---|---|
| `session-control/message-handler.ts` | Pre-dispatch check for `metadata.kind === "subagent-task"` |
| `session-control/types.ts` | Add `SubagentTaskMetadata` type |
| `pi-subagents/session-runner.ts` | Add `harness` parameter, route to socket-harness |
| `pi-subagents/types.ts` | Add `SocketLaunchConfig` type |

### New dependency

`pi-subagents` gains a dependency on `pi-toolkit/session-control` (for
`sendRpcCommand` and `SubagentResult` types). This is the first cross-package
dependency between a process package and a toolkit package — it's intentional
and narrow. The dependency is on the session-control client + types, not the
server.

## 7. Implementation Status

| Phase | Status | Files |
|---|---|---|
| 2a — subagent-runner.ts | ✅ Done | `session-control/subagent-runner.ts` |
| 2b — socket-harness.ts | ✅ Done | `pi-subagents/harness/socket-harness.ts` |
| 2c — harness selection | ✅ Done | `harness-pi-rpc.ts` delegates to socket-harness |
| 2d — integration testing | ⏳ Pending | Needs arm64 test runner |
| 2e — default for background agents | ⏳ Pending | Needs pi-dispatch spawn wiring |
| 2f — default for all subagents | ⏳ Pending | After pool mode proves stability |

### Tests (compiled, not executed — rolldown arm64 binding missing)
- `pi-toolkit/session-control/test/subagent-dispatch.test.ts` — 3 tests: subagent-task routing, normal bypass, metadata filtering
- `pi-subagents/test/ledger.test.ts` — 13 tests: spawn, status, read, collected, reconciliation
- `pi-subagents/test/parent-key.test.ts` — 4 tests: create, stable, persist, sync
