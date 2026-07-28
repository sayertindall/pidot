---
name: session-control
description: "Send messages between running pi sessions via Unix socket RPC. Use send_to_session for cross-session communication, list_sessions for discovery, subscribe to turn_end for async coordination, and quiet mode for non-disruptive notifications. Trigger when the user mentions talking to other pi sessions, coordinating across sessions, subagent communication, session-to-session messaging, or pi process orchestration."
---

# Session Control

Every pi session is a node on the bus. Sessions discover each other via the socket directory, message each other over Unix sockets, subscribe to events, and queue messages for offline peers.

## Decision Tree

```
You need to communicate with another session
  │
  ├─ Don't know what sessions exist?
  │   → list_sessions() first. Always.
  │
  ├─ Fire-and-forget notification ("build passed", "PR ready")
  │   → send_to_session({ sessionName: "worker", message: "...", quiet: true })
  │
  ├─ Need a reply before continuing
  │   → send_to_session({ sessionName: "worker", message: "...", wait_until: "turn_end" })
  │
  ├─ Long-running task, want to be notified on completion
  │   → send_to_session({ ... }) + subscribe to result_ready event
  │
  ├─ Just want a summary of what the session did
  │   → send_to_session({ sessionName: "worker", action: "get_summary" })
  │
  ├─ Need the last assistant message (no new turn)
  │   → send_to_session({ sessionName: "worker", action: "get_message" })
  │
  └─ Need to abort or reset a session
      → send_to_session({ sessionName: "worker", action: "abort" | "clear" })
```

## Always List Before Sending

Call `list_sessions()` first. Session names can be stale — a session crashed, was renamed, or never started. Listing confirms liveness.

```
// RIGHT
list_sessions()
→ discovers "worker-1", "orchestrator" are live
send_to_session({ sessionName: "worker-1", message: "..." })

// WRONG — guessing names
send_to_session({ sessionName: "worker", message: "..." })
→ "Unknown session name: worker"
```

Filter by tags when you have many sessions:

```
list_sessions({ tags: { role: "worker", pool: "auth-refactor" } })
→ only workers in the auth-refactor pool
```

## Quiet Send for Notifications

Use `quiet: true` for status updates that don't need an immediate LLM response:

```
// Build finished — notification only
send_to_session({
  sessionName: "orchestrator",
  message: "Build complete: 0 errors, 142 tests passed. Ready for next task.",
  quiet: true
})
```

The message appears in the transcript. The model sees it on the NEXT turn but doesn't wake up for it. Use for:
- Build/test results
- Progress updates ("Task 3/5 complete")
- Status changes ("Worker-2 is now idle")

## Wait for Reply

When you need a response before continuing, use `wait_until`:

```
// Block until the worker processes the message and returns its reply
send_to_session({
  sessionName: "worker",
  message: "What's the current git branch and what files are changed?",
  wait_until: "turn_end"
})
// Returns worker's assistant response as the tool result
```

`wait_until: "message_processed"` confirms delivery without waiting for a turn. `wait_until: "result_ready"` waits for a structured subagent result (Phase 2).

## Offline Sessions

Sessions can be offline. Messages queue to a mailbox and deliver on next start:

```
send_to_session({ sessionName: "worker", message: "Task for when you're back" })
→ "Session offline — message queued for delivery on next start"
```

Don't retry-loop a dead session. The message will deliver when the session starts. Check back later with `list_sessions` to confirm liveness.

## Subscribe to Events

For long-running coordination, subscribe instead of polling:

```
// In the orchestrator: wait for the worker to finish and get structured result
send_to_session({
  sessionName: "worker",
  message: "Run the full test suite and report back.",
  wait_until: "result_ready"
})
// Returns: { runId, status: "completed", output: "...", toolCount: 12, ... }
```

Subscriptions are connection-scoped — they survive multiple turns.
`result_ready` is one-shot (fires once per subagent run). `turn_end` fires
after every agent turn and persists across turns until unsubscribed.

## Subagent Task Execution

Your session can receive and execute subagent tasks from other sessions.
When a message arrives with `metadata.kind === "subagent-task"`, the
session-control server routes it to the subagent runner:

1. Inbound `send` with metadata `{ kind: "subagent-task", agentConfig: {...} }`
2. `subagent-runner.ts` deserializes the agent config
3. Calls pi-subagents' `runAgent()` to execute the task
4. Writes result to `~/.pi/agent/pi-subagents/results/<runId>.json`
5. Emits `result_ready` event with typed `SubagentResult`
6. If `lifecycle: "single"`, shuts down after emitting

**This is automatic.** You don't call `send_to_session` with subagent-task
metadata — the parent's socket harness does. Your session just runs the
agent when it receives the task.

## Persistence & Reload Safety

Session-control survives reloads, forks, and switchSession operations.
The extension detects stale contexts and self-heals:

```
/reload
→ old context goes stale
→ alias sync timer catches the stale-context error, self-clears
→ new session_start fires, timers recreated with fresh context
→ socket server restarted on existing socket path
```

**Mailbox drain on start:** when a session starts, it drains any messages
queued in `<id>.mailbox`. Messages that failed 3+ times move to `<id>.mailbox.dead`.

**Socket directory GC:** dead sockets cleaned up on `session_start` + every 60s.
The oldest-alive session runs GC to avoid thundering herd.

## Session Discovery Shortcut

In the editor, type `session:` and autocomplete shows live sessions:

```
session:wor     → suggests: session:worker-1, session:worker-2
```

Use this instead of typing session IDs manually.

## Shell Scripts

`PI_SESSION_ID` is exported for child processes:

```bash
# Send a quiet notification from a build script
echo '{"type":"send","message":"Build finished","quiet":true}' \
  | nc -U ~/.pi/session-control/<target-id>.sock
```

## Destructive Actions

`clear` rewinds a session to root — all context lost. `abort` kills the current turn. Use sparingly:

- `clear`: when a worker finished its task and should be reset for the next one (pool workers)
- `abort`: when a worker is stuck in a loop or the task is cancelled

Destructive actions are logged. `clear` writes a `session-cleared` entry before executing.
Confirm with `confirmDestructiveActions: true` in config if you want a safety gate.

## Rate Limiting

Each socket server enforces 60 messages/min per connection. Exceeded →
response with `{ success: false, error: "rate_limited" }`. Back off and retry.
Subscriptions and unsubscriptions bypass rate limiting.

## Session Tags

Sessions can have key-value tags for discovery:

```
/tag role worker
/tag pool auth-refactor
```

Tags stored in `<id>.tags` JSON next to the socket. Use `list_sessions`
with tag filters to find specific workers or pools.
