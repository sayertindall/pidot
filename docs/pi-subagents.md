# pi-subagents

Delegate tasks to specialized subagents with isolated context windows. Spawns
child `pi` sessions via the pi-dispatch PTY engine.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process with its own context window
- **Agent discovery**: Loads agent definitions from user dir, project dir, and bundled defaults
- **Parallel fan-out**: Run N agents concurrently with configurable concurrency
- **Sequential chains**: Pipeline agents with `{previous}` placeholder for result passing
- **Streaming output**: Tool calls and progress stream live
- **Worktree isolation**: Agents run in isolated git worktrees (optional)
- **Scheduling**: Deferred execution via `schedule` (e.g., `+10m`, ISO timestamp)
- **Abort support**: Ctrl+C propagates to kill all running subagent processes
- **Steering**: Send follow-up guidance to a running agent mid-execution
- **Usage tracking**: Turns, tokens, cost, and context usage per agent

## Structure

```
pi-subagents/extensions/subagents/
├── index.ts              # Extension entry — registers tools + /agents command
├── session-runner.ts     # Core spawner — calls createAgentSession, streams events
├── harness-pi-rpc.ts     # RPC harness — delegates to socket-harness (was stub)
├── discovery.ts          # Agent definition loading + parsing
├── state.ts              # Agent state management (queued → running → done/error)
├── schedule.ts           # Deferred scheduling
├── runtime.ts            # Lifecycle orchestration
├── types.ts              # AgentConfig, PiRpcLaunchConfig, HarnessResult, etc.
├── harness/              # Parent-side socket transport (NEW)
│   ├── socket-harness.ts # Spawns via dispatch, communicates over session-control socket
│   └── run-id.ts         # Run ID generator
└── ledger/               # Subagent persistence (NEW)
    ├── ledger.ts         # Append-only JSONL ledger, reconciliation, collected tracking
    └── parent-key.ts     # Persistent key for cross-session child discovery

test/
├── ledger.test.ts        # 13 tests: spawn, status, read, collected, reconciliation
├── parent-key.test.ts    # 4 tests: create, stable, persist, sync
└── (existing tests unchanged)
```

## Tools

| Tool | Description |
|---|---|
| `subagent` | Single agent, parallel fan-out, or sequential chain execution |
| `subagent_wait` | Block until background subagent work completes |
| `subagent_supervisor` | Reply to child subagent requests |

## Commands

| Command | Description |
|---|---|
| `/agents` | List available agents and chains |

## Execution Modes

### Single agent
```
subagent({ agent: "finder", task: "locate all auth code" })
```

### Parallel fan-out
```
subagent({ tasks: [
  { agent: "finder", task: "find models", count: 2 },
  { agent: "review", task: "review auth.ts" }
], concurrency: 4 })
```

### Sequential chain
```
subagent({ chain: [
  { agent: "finder", task: "Research {task}" },
  { agent: "oracle", task: "Plan based on {previous}" }
] })
```

### Deferred (schedule)
```
subagent({ agent: "finder", task: "scan codebase", schedule: "+10m" })
```

## Agent Definitions

Markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: anthropic/claude-sonnet-4
thinking: high
---

System prompt for the agent goes here.
```

**Locations:**
- `~/.pi/agent/agents/*.md` — User-level (always loaded)
- `.pi/agents/*.md` — Project-level (opt-in via `agentScope`)

## Worktree Isolation

When `worktree: true`, agents run in isolated git worktrees:
- Changes committed to branch on completion
- Worktree cleaned up based on `worktreePolicy`: `keep`, `prune-on-success`, `prune-always`

## Steering

Send live guidance to a running agent:
```
subagent_supervisor({ action: "steer", id: "run-abc", message: "Focus on auth middleware" })
```

## Socket Transport (Phase 2)

Subagents can run in crash-isolated separate processes via session-control
sockets instead of in-process. Use `harness: "socket"`:

```
subagent({ agent: "finder", task: "locate auth code", harness: "socket" })
```

The parent spawns a child pi via `interactive_shell`, waits for its
session-control socket, sends the task with `metadata.kind: "subagent-task"`,
and collects the typed `SubagentResult` via the `result_ready` event.

**No more polling.** One `send_to_session` call with `wait_until: "result_ready"`
replaces the 40+ `get_subagent_result` polling loop.

See [subagent-socket-transport spec](../docs/specs/subagent-socket-transport.md).

## Persistence

Subagents survive crashes, reloads, and restarts:
- **Ledger** (`~/.pi/agent/pi-subagents/ledger.jsonl`): append-only spawn + status log
- **Results** (`~/.pi/agent/pi-subagents/results/<runId>.json`): canonical subagent output
- **Collected** (`~/.pi/agent/pi-subagents/collected.json`): dedup prevention
- **Parent key** (`~/.pi/agent/pi-subagents/parent-key`): survives session file changes

On `session_start`, `reconcilePersistedChildren()` finds orphaned children,
collects completed results, and surfaces crashes.

See [subagent-persistence spec](../docs/specs/subagent-persistence.md).

## Error Handling

- **Exit code != 0**: Error propagated with stderr/output
- **stopReason "error"**: LLM error propagated
- **stopReason "aborted"**: User abort kills subprocess
- **Chain mode**: Stops at first failing step
- **Timeout**: Configurable per-agent timeout via `timeoutMs`

## Limitations

- Parallel mode limited by `concurrency` (default 4)
- Chain mode: output from previous step passed as text — no structured data
- Schedule requires `scheduledRuns.enabled: true` in config
- Worktree mode requires clean git state
- **Socket harness**: Spawn flow not yet wired to pi-dispatch (Phase 2c pending). `harness: "socket"` returns "not yet wired" for now.
- **Reconciliation**: `reconcilePersistedChildren` API ready, not yet called on `session_start`
