---
name: dispatch
description: "Spawn and supervise CLIs in real PTY sessions. Use interactive_shell for running external commands, delegating to coding agents (pi/claude/codex), background tasks, and monitor-mode log watching. Trigger when the user asks to run a command in a terminal, spawn another coding agent, watch logs, or run background processes."
---

# Dispatch (interactive_shell)

Spawns any CLI in a real pseudo-terminal and supervises it. Four modes for different needs: interactive (user watches), hands-free (agent monitors), dispatch (fire-and-forget), and monitor (log watching).

## Decision Tree

```
You need to run something in a terminal
  │
  ├─ User wants to watch/interact
  │   → mode: "interactive" — full TUI overlay, user can scroll, transfer output
  │
  ├─ Fire-and-forget (spawn another pi, run a script)
  │   → mode: "dispatch" — headless, notified on completion
  │
  ├─ Need to watch for specific output ("wait until tests pass")
  │   → mode: "hands-free" — agent polls, user can take over
  │
  └─ Watching logs or test output for patterns
      → mode: "monitor" — stream triggers, poll-diff, or file-watch
```

## Spawn Coding Agents

When the user says "open another pi session" or "run claude on this":

```
interactive_shell({
  spawn: { agent: "pi", prompt: "Review the auth module for security issues" },
  mode: "dispatch",
  background: true
})
```

Supported agents: `pi`, `claude`, `codex`, `cursor`, `gemini`.

### Subagent Workers

Dispatch mode + background + session naming is the spawn mechanism for
crash-isolated subagents (pi-subagents socket harness):

```
interactive_shell({
  spawn: { agent: "pi", mode: "fresh" },
  mode: "dispatch",
  background: true,
  name: "subagent-finder-a1b2c3d4"
})
// Child creates session-control socket at ~/.pi/session-control/<id>.sock
// Parent discovers it by name, sends task over socket
// Child runs agent, emits result_ready, exits
```

The child is a normal pi session. It creates a session-control socket on start.
The parent communicates over the socket — no stdio pipes, no polling. When the
child finishes, it emits `result_ready` with a typed `SubagentResult`.

**Key settings for subagent workers:**
- `mode: "dispatch"` — headless, no TUI overlay
- `background: true` — don't block the parent
- `name` — makes the child discoverable via `list_sessions` + session-control aliases
- `spawn: { mode: "fresh" }` — clean session, no inherited context

## Monitor Mode

Watch for patterns in streaming output — more efficient than polling:

```
interactive_shell({
  command: "npm test -- --watch",
  mode: "monitor",
  monitor: {
    strategy: "stream",
    triggers: [
      { id: "fail", literal: "FAIL" },
      { id: "pass", literal: "passed", threshold: { captureGroup: 1, op: "gt", value: 0 } }
    ]
  }
})
```

Monitor strategies:
- `stream`: line-by-line regex/literal matching
- `poll-diff`: periodic snapshot diffing (for non-streaming output)
- `file-watch`: filesystem events (log files, output directories)

Triggers are deduplicated by default. Add `cooldownMs` to prevent spam on rapidly-firing patterns.

## Background Sessions

Long-running sessions belong in the background:

```
interactive_shell({
  command: "npm run dev",
  mode: "dispatch",
  background: true
})
// Returns immediately. Session appears in the status widget.
// Check status: interactive_shell({ sessionId: "abc-123" })
// Kill when done: interactive_shell({ sessionId: "abc-123", kill: true })
```

## Cleanup

Dismiss sessions when done. Leaking PTYs wastes resources:

```
/dismiss              → interactive picker
listBackground()      → see what's running
interactive_shell({ dismissBackground: true })  → kill all
```

## Worktree Isolation

For isolated work, spawn in a git worktree:

```
interactive_shell({
  spawn: { agent: "pi", mode: "fresh", worktree: true },
  mode: "dispatch",
  background: true
})
```

The agent runs in a separate git worktree. Changes are committed to a branch. Worktree is kept or pruned based on `worktreePolicy`.

## Session Naming

Name sessions for later discovery via session-control:

```
interactive_shell({
  spawn: { agent: "pi" },
  mode: "dispatch",
  background: true,
  name: "auth-reviewer"
})
// Creates ~/.pi/session-control/auth-reviewer.alias → <id>.sock
// Other sessions can now: send_to_session({ sessionName: "auth-reviewer", ... })
```

Named sessions appear in `list_sessions` and `session:` autocomplete.
Use meaningful names: `worker-1`, `auth-reviewer`, `test-runner`.
Subagent workers use `subagent-<agent>-<runId-short>` by convention.
