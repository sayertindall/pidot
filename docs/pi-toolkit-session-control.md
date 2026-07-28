# pi-toolkit: Session Control

Always-on session communication bus. Every pi session creates a Unix domain
socket at `~/.pi/agent/pi-toolkit/session-control/<id>.sock`. Other sessions — or shell scripts —
discover and message each other over these sockets.

## Features

- **Always-on**: No `--session-control` flag. If the extension is loaded, the socket exists
- **Out-of-band metadata**: Sender identity travels in the RPC envelope, never in message text
- **Offline mailbox**: Messages to offline sessions queued to `<id>.mailbox` JSONL, drained on next start
- **Quiet send**: Deliver without triggering a turn — model sees it next turn
- **Session tags**: Key-value discovery (`role: worker`, `pool: auth-refactor`)
- **AI summarization**: `get_summary` RPC returns model-generated summary of recent activity
- **Clear + abort**: Remote session rewind and turn abort
- **Turn end events**: Subscribe to `turn_end` or `result_ready` events from a target session
- **Rate limiting**: 60 messages/min per server
- **Socket directory GC**: Dead sockets cleaned up on session start + 60s interval timer
- **Autocomplete**: `session:` prefix in editor suggests live session names
- **PI_SESSION_ID**: Exported as env var for shell scripts

## Structure

```
pi-toolkit/session-control/extensions/session-control/
├── index.ts              # Extension entry — wires hooks, tools, lifecycle
├── types.ts              # RPC envelope, 9 commands, SubagentResult, SessionTags,
│                         # SubagentTaskMetadata
├── protocol.ts           # JSON-RPC newline-delimited wire format
├── registry.ts           # Socket directory, aliases (symlinks), tags (JSON),
│                         # mailbox (JSONL), GC, dead socket cleanup
├── server.ts             # Unix socket server — create/bind/listen/stop
├── client.ts             # RPC client — sendCommand with event subscription
├── message-handler.ts    # Per-command dispatch, rate limiting, event firing,
│                         # subagent-task interception before normal send
├── subagent-runner.ts    # Child-side agent executor — receives subagent-task
│                         # metadata, runs agent via pi-subagents' runAgent(),
│                         # writes result file, emits result_ready
├── summarizer.ts         # Model selection (Codex mini → Haiku → parent) + AI summary
├── hooks.ts              # Alias sync, PI_SESSION_ID env, status bar,
│                         # stale context detection (reload/fork/switchSession safe)
├── autocomplete.ts       # session: prefix autocomplete provider
├── tools/
│   ├── send-to-session.ts  # send_to_session tool (all 6 actions)
│   └── list-sessions.ts    # list_sessions tool (tag filtering)
└── commands/
    └── control-sessions.ts # /control-sessions TUI command

test/
├── subagent-dispatch.test.ts  # 3 tests: subagent-task routing in message-handler
└── (vitest.config.ts)
```

## Tools

| Tool | Description |
|---|---|
| `send_to_session` | Send messages, get summary, get result, clear, or abort a target session |
| `list_sessions` | Discover live sessions with optional tag filtering |

### send_to_session

```
send_to_session({ sessionName: "worker", message: "Fix auth.ts" })
send_to_session({ sessionName: "worker", action: "get_summary" })
send_to_session({ sessionName: "worker", action: "clear" })
send_to_session({ sessionName: "worker", action: "abort" })
send_to_session({ sessionName: "worker", message: "...", wait_until: "turn_end" })
send_to_session({ sessionName: "worker", message: "...", quiet: true })
send_to_session({ sessionName: "worker", message: "...", wait_until: "result_ready" })
```

| Parameter | Description |
|---|---|
| `sessionId` | Target session UUID |
| `sessionName` | Target session alias (from `/name`) |
| `action` | `send` (default), `get_message`, `get_summary`, `get_result`, `clear`, `abort` |
| `message` | Message text (required for `send`) |
| `mode` | `steer` (immediate) or `follow_up` (after task) |
| `quiet` | Deliver without triggering a turn |
| `wait_until` | `turn_end`, `message_processed`, or `result_ready` |

### list_sessions

```
list_sessions()
list_sessions({ tags: { role: "worker" } })
list_sessions({ tags: { pool: "auth-refactor", project: "pi-extensions" } })
```

## Commands

| Command | Description |
|---|---|
| `/control-sessions` | List live sessions in the TUI (no turn triggered) |

## RPC Protocol

Newline-delimited JSON over Unix domain sockets.

### Commands

| Command | Parameters | Response data |
|---|---|---|
| `send` | `message`, `mode?`, `quiet?`, `metadata?` | `{ delivered, mode }` |
| `get_message` | — | `{ message? }` |
| `get_summary` | — | `{ summary, model }` |
| `get_result` | — | `{ result?: SubagentResult }` |
| `clear` | — | `{ cleared, alreadyAtRoot? }` |
| `abort` | — | `{}` |
| `subscribe` | `event: "turn_end" \| "result_ready"` | `{ subscriptionId }` |
| `unsubscribe` | `subscriptionId` | `{ removed }` |
| `forward_tool` | `tool`, `args` | (Phase 2) |

### Events (server → client)

| Event | Trigger | Payload |
|---|---|---|
| `turn_end` | After agent turn settles | `{ message?, turnIndex }` |
| `result_ready` | Subagent run completes (Phase 2) | `{ runId, result }` |

### Metadata (send command)

```json
{
  "type": "send",
  "message": "Fix the auth bug",
  "mode": "steer",
  "metadata": {
    "senderId": "abc123",
    "senderName": "orchestrator",
    "runId": "run-xyz",
    "kind": "subagent-task"
  }
}
```

Metadata is out-of-band — never injected into message text.

## Session Tags

Key-value tags stored in `<id>.tags` JSON next to the socket:

```json
{
  "role": "worker",
  "pool": "auth-refactor",
  "project": "pi-extensions"
}
```

Set via `/tag` command (planned) or agent config. Filter sessions by tag:

```
list_sessions({ tags: { role: "worker" } })
```

## Offline Mailbox

If the target session isn't running, `send` writes to `<id>.mailbox`:

```
~/.pi/agent/pi-toolkit/session-control/<id>.mailbox  →  JSONL of pending messages
```

On `session_start`, the session drains its mailbox — delivering each queued
message in order. Messages that fail after 3 retries move to `<id>.mailbox.dead`.

## Shell Scripts

`PI_SESSION_ID` is exported for child processes:

```bash
# Send a message to another session from a script
echo '{"type":"send","message":"Build finished","quiet":true}' \
  | nc -U ~/.pi/agent/pi-toolkit/session-control/<target-id>.sock
```

## Configuration

```json
{
  "session-control": {
    "enabled": true,
    "socketDir": "~/.pi/agent/pi-toolkit/session-control",
    "confirmDestructiveActions": false,
    "aliasSyncIntervalMs": 1000,
    "subagentResultTimeoutMs": 300000,
    "rateLimit": {
      "messagesPerMinute": 60,
      "maxSubscribers": 8
    },
    "gc": {
      "intervalMs": 60000,
      "deadMailboxRetentionDays": 7
    },
    "mailbox": {
      "enabled": true,
      "maxRetries": 3
    },
    "pool": {
      "maxWorkersPerAgent": 8,
      "idleTimeoutMs": 300000,
      "healthCheckIntervalMs": 30000
    }
  }
}
```

## Testing (two-terminal quickstart)

**Terminal 1 — Orchestrator:**
```bash
pi --ext ./packages/pi-toolkit/session-control/extensions/
```
```
/name orchestrator
```

**Terminal 2 — Worker:**
```bash
pi --ext ./packages/pi-toolkit/session-control/extensions/
```
```
/name worker
```

**In orchestrator, test each interaction:**

| Prompt | Expected tool call |
|---|---|
| `List all live sessions with control sockets.` | `list_sessions()` |
| `Send a message to the worker saying "Hello from orchestrator. Reply with your current git branch."` | `send_to_session({ sessionName: "worker", message: "..." })` |
| `Ask the worker session what files it sees in the current directory, and wait for the reply.` | `send_to_session({ ... , wait_until: "turn_end" })` |
| `Send a quiet notification to the worker saying "Build CI passed" without triggering a turn.` | `send_to_session({ ... , quiet: true })` |
| `Get an AI-generated summary of the worker session's recent activity.` | `send_to_session({ action: "get_summary" })` |

**In worker, verify received messages:**
```
What messages did I receive from other sessions?
```

**Check socket directory:**
```bash
ls -la ~/.pi/agent/pi-toolkit/session-control/
# orchestrator.alias -> <uuid>.sock
# worker.alias -> <uuid>.sock
```

## Subagent Integration (Phase 2)

When a `send` command carries `metadata.kind === "subagent-task"`, the
message handler routes it to `subagent-runner.ts` instead of normal delivery:

1. Child session receives task with full agent config in metadata
2. `runSubagentTask()` calls pi-subagents' `runAgent()` to execute
3. Result captured as typed `SubagentResult`, written to `~/.pi/agent/pi-subagents/results/<runId>.json`
4. `result_ready` event emitted to all subscribers
5. Parent's `socket-harness.ts` collects `SubagentResult` via `waitForEvent: "result_ready"`

This replaces the polling loop (`get_subagent_result` every 3 seconds) with
a single socket-level wait. See [subagent-socket-transport spec](../docs/specs/subagent-socket-transport.md).

## Persistence (Phase 2)

Subagent results survive crashes, reloads, and restarts:

| Artifact | Location | Purpose |
|---|---|---|
| Ledger | `~/.pi/agent/pi-subagents/ledger.jsonl` | Append-only spawn + status change log |
| Results | `~/.pi/agent/pi-subagents/results/<runId>.json` | Canonical result file (write-then-emit) |
| Collected | `~/.pi/agent/pi-subagents/collected.json` | Tracks which results parent has seen |
| Parent key | `~/.pi/agent/pi-subagents/parent-key` | Persistent ID for cross-session child discovery |

See [subagent-persistence spec](../docs/specs/subagent-persistence.md).

## Limitations

- **Same-machine only**: Unix sockets don't cross hosts (Phase 4 adds SSH tunnels)
- **No long-term message queue**: Mailbox holds until next drain
- **forward_tool**: Accepted but returns "not implemented" (Phase 3)
- **Pool mode**: Defined in spec, not yet implemented (Phase 3)
- **Tests**: Compiled and type-checked. Cannot execute (rolldown arm64 binding missing)
- **Full spawn flow**: `socket-harness.ts` fullSpawnAndCollect() requires pi-dispatch wiring (Phase 2c)
