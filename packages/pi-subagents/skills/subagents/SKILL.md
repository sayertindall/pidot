---
name: subagents
description: "Delegate tasks to isolated subagents for parallel work, fan-out search, sequential chains, and long-running background tasks. Use when the user asks to split work across agents, run things in parallel, fan out research, set up planner-worker splits, or delegate tasks that need isolated context windows. Trigger when you hear: split this up, run in parallel, delegate, fan out, subagent, worker, chain, pool."
---

# Subagents

Delegate work to isolated pi sessions. Each agent gets its own context window, tools, and model. The orchestrator (you) sends tasks, monitors progress, steers mid-flight, and collects results.

## Decision Tree

```
User asks you to do multiple things at once
  │
  ├─ Same codebase, independent tasks, no shared state needed
  │   → fan-out: subagent({ tasks: [{agent:"finder", task:"..."}, ...] })
  │
  ├─ Tasks feed into each other (research → plan → execute)
  │   → chain: subagent({ chain: [{agent:"finder"}, {agent:"planner"}, {agent:"executor"}] })
  │
  ├─ Single task, isolated context or different model needed
  │   → single: subagent({ agent: "general-purpose", task: "..." })
  │
  └─ One small thing (single file read, trivial grep, < 3 tool calls)
      → DON'T subagent. Just do it yourself.
```

## When NOT to Subagent

- **Single file read or trivial grep**: spawning a subprocess costs 2-5 seconds. Just use `read` or `grep`.
- **Under 3 tool calls**: the overhead of spawn + prompt + result collection exceeds the work.
- **Sequential work that needs shared state**: subagents have isolated context. If step B needs step A's in-memory state, use a chain (explicit handoff) or do it yourself.
- **User explicitly says "don't delegate"**: respect it.

## Fan-out Pattern

When you have N independent searches or analyses:

```
"Find where auth logic lives in these directories: src/auth, src/middleware, src/api"
→ 3 finder agents in parallel, concurrency: 3
```

```
subagent({
  tasks: [
    { agent: "finder", task: "Find auth code in src/auth/", count: 1 },
    { agent: "finder", task: "Find auth code in src/middleware/", count: 1 },
    { agent: "finder", task: "Find auth code in src/api/", count: 1 }
  ],
  concurrency: 3
})
```

**Count != concurrency.** `count: 3` spawns 3 instances of the same agent with the same task — rarely useful. `concurrency: 3` lets 3 different tasks run at once. Use concurrency for fan-out, count for sharding.

## Chain Pattern

Research feeds into planning feeds into execution:

```
subagent({
  chain: [
    { agent: "finder", task: "Research how auth middleware works in this codebase" },
    { agent: "planner", task: "Using this research: {previous}\n\nCreate a refactoring plan." },
    { agent: "general-purpose", task: "Using this plan: {previous}\n\nExecute the refactoring." }
  ]
})
```

`{previous}` expands to the previous agent's full output. Use `{task}` to reference the original user request.

## Steering over Respawning

If a running agent is going off-track, don't kill and restart it:

```
// WRONG: kill + respawn
interactive_shell({ kill: true, sessionId: "run-xyz" })
subagent({ agent: "finder", task: "..." })  // cold start, wasted context

// RIGHT: steer mid-flight
subagent_supervisor({ action: "steer", id: "run-xyz", message: "Focus on auth middleware, not the database layer." })
```

Steering preserves the agent's accumulated context (files read, decisions made). Respawning throws it all away.

## Background Agents

Long-running work that doesn't block the orchestrator:

```
subagent({
  agent: "general-purpose",
  task: "Run the full test suite and analyze failures",
  async: true
})
// Returns immediately with runId. Use subagent_wait to be notified on completion.
```

Background agents report completion via `subagent_wait` or the status widget.

**Never poll.** Don't call `get_subagent_result` in a loop checking "are you done yet?"
That burns turns, wastes context, and delays the actual work. The agent finishes when
it finishes — `subagent_wait` or socket events will tell you.

## Socket Transport (Crash Isolation)

For crash-isolated subagents in separate processes, use `harness: "socket"`:

```
subagent({
  agent: "finder",
  task: "locate auth code",
  harness: "socket"
})
```

The parent spawns a child pi via `interactive_shell`, communicates over
session-control Unix sockets, and receives a typed `SubagentResult` via the
`result_ready` event. The child runs as a separate process — if it crashes,
the parent keeps running.

**When to use socket harness:**
- Long-running tasks where child crash shouldn't kill the parent
- Tasks that might exhaust context or hit model errors
- Cross-machine delegation (future: SSH-tunneled sockets)

**When to keep in-process:**
- Quick tasks (under 10 tool calls) — spawn overhead isn't worth it
- Tasks that need the parent's exact model state

Socket transport replaces the old `get_subagent_result` polling loop with a
single blocking `send_to_session` call that waits for the `result_ready` event.
Zero wasted turns.

## Persistence

Subagents survive crashes, reloads, and restarts. The parent tracks every
spawn in a ledger and can reconnect to orphaned children on restart:

```
Parent spawns child → ledger: run-001 → running
Parent crashes (kill -9)
Child keeps running, finishes, writes result file
Parent restarts
session_start → reconcilePersistedChildren()
→ finds run-001 completed, injects result into session
```

**What persists:**
- **Ledger** (`~/.pi/agent/pi-subagents/ledger.jsonl`): every spawn + status change
- **Results** (`~/.pi/agent/pi-subagents/results/<runId>.json`): canonical subagent output
- **Parent key** (`~/.pi/agent/pi-subagents/parent-key`): survives session file changes

**What this means for you:**
- If a subagent was running when the session reloaded, check if it finished.
  Reconciliation on session_start injects completed results automatically.
- If a subagent crashed (no result file, no live socket), you'll see a system
  message like: "Subagent 'finder' (run-001) crashed before completing."
- Results are deduplicated — restarting twice won't inject the same result twice.

## Pool Mode (Phase 3)

When available, prefer pool workers for repeated same-agent tasks:

```
subagent({
  agent: "worker",
  task: "Refactor auth.ts",
  pool: { strategy: "round-robin", workers: 3 }
})
```

Pool workers stay warm across tasks — no cold-start overhead. They're cleared between tasks but keep filesystem caches and model connection.

## Agent Discovery

Before spawning, check what's available:

```
/agents   → lists all defined agents (bundled + user + project)
```

Three built-in agents always exist: `general-purpose`, `Explore`, `Plan`. Custom agents defined in `~/.pi/agent/agents/*.md` or `.pi/agents/*.md`.

## Error Handling

- **Exit code != 0 / status: "failed"**: The result includes an error message. Read it, fix the cause, retry.
- **stopReason "aborted" / status: "stopped"**: User pressed Ctrl+C or child was killed. Don't retry without asking.
- **Chain failure**: Chain stops at the first failing step. Fix and resume from the failed step.
- **Timeout / turn limit**: Agent hit maxTurns. Result has partial output with `status: "stopped"` and `stoppedReason: "turn-limit"`.
- **Socket disconnected (ECONNRESET)**: Child crashed mid-task. The parent receives the error. Check the ledger — if the child wrote a result file before crashing, reconciliation will pick it up.
- **Socket never appears**: Child failed to start (10s timeout). The parent marks the ledger entry "crashed". Retry the spawn.
