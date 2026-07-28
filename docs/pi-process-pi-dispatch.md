# pi-dispatch

PTY-based dispatch engine. Powers the `interactive_shell` tool — spawn any CLI
in a real pseudo-terminal and supervise it to completion. The backbone of pi's
process orchestration.

## Features

- **Four supervision modes**: interactive, hands-free, dispatch, monitor
- **Real PTY**: Spawns any CLI in a genuine pseudo-terminal via node-pty
- **Overlay rendering**: Full-screen TUI overlay with live PTY output, scroll, transfer
- **Background sessions**: Detach, list, reattach, dismiss running sessions
- **Monitor triggers**: Stream matching (literal/regex), poll-diff detection, file-watch events with threshold comparison
- **Key encoding**: Special keys (Ctrl+*, Alt+*, function keys) encoded per target CLI
- **Frame parsing**: ANSI/control sequence handling, scrollback, incremental/drain query
- **Run records**: Persistent audit trail of all sessions under `~/.pi/agent/pi-dispatch/runs/`
- **Worktree integration**: Spawn agents in isolated git worktrees
- **Status widget**: Live session lane below editor showing all running/monitoring sessions
- **Dismiss cleanup**: Removes from registry + in-memory index + disk file — no `/reload` needed

## Structure

```
pi-dispatch/extensions/shell/
├── index.ts          # Extension entry — registers tool, commands, shortcuts, hooks
├── commands.ts       # interactive_shell tool handler, /spawn /attach /dismiss commands
├── runtime.ts        # PtyRuntime — PTY lifecycle, sliceLogOutput, state machine
├── spawn.ts          # node-pty spawn, worktree creation, sentinel wrapping
├── supervision.ts    # HeadlessSupervisor — monitor/trigger/cooldown logic
├── coordinator.ts    # DispatchCoordinator — manages monitor sessions
├── session.ts        # SessionRegistry — live session tracking, reattach
├── overlay.ts        # TUI overlay rendering (popup terminal window)
├── frame.ts          # Chrome: header, footer, borders, status dots
├── triggers.ts       # Monitor trigger compilation, buffering, dedup
├── key-encoding.ts   # Key encoding for target CLIs
├── config.ts         # interactive-shell.json loading, spawn defaults
├── state.ts          # RunRecord persistence (index + disk), deleteRunRecord
├── widget.ts         # bg-sessions widget — status lane below editor
├── types.ts          # TypeBox schemas, formatDuration, formatShortcut
├── schemas.ts        # On-disk RunRecord schema (snake_case)
└── completion.ts     # Completion contract (exit-code vs sentinel)
```

## Tools

| Tool | Description |
|---|---|
| `interactive_shell` | Spawn CLI in PTY with supervision mode |

### Tool parameters

| Parameter | Description |
|---|---|
| `command` | Raw CLI command string |
| `spawn` | Structured spawn request (`{ agent, mode, worktree, prompt }`) |
| `mode` | `"interactive"`, `"hands-free"`, `"dispatch"`, `"monitor"` |
| `monitor` | Monitor config (`{ strategy, triggers, fileWatch, poll }`) |
| `background` | Run headless without overlay |
| `sessionId` | Query/kill/dismiss/attach an existing session |
| `attach` | Reattach background session to overlay |
| `listBackground` | List all background sessions |
| `dismissBackground` | Dismiss all (`true`) or specific session (ID string) |

## Commands

| Command | Description |
|---|---|
| `/spawn` | Spawn a CLI in a new PTY session |
| `/attach` | Reattach to a background session by ID |
| `/dismiss` | Dismiss sessions interactively (single, all, or select from list) |

## Shortcuts

| Shortcut | Description |
|---|---|
| Configurable via `focusShortcut` | Focus/unfocus the shell overlay |

## Overlay controls (interactive mode)

| Key | Action |
|---|---|
| `Ctrl+T` | Transfer output to agent |
| `Ctrl+B` | Background the session |
| `Ctrl+Q` | Detach dialog (transfer/background/kill/cancel) |
| `Shift+Up/Down` | Scroll output |
| `Alt+Shift+F` | Focus/unfocus overlay |

## Supervision modes

| Mode | Behavior | Use case |
|---|---|---|
| `interactive` | User controls via overlay. Exit code is ground truth. | Blocking delegation, user watches |
| `hands-free` | Agent monitors via polling. User can take over. Quiet detection auto-exits. | Fire-and-forget with visibility |
| `dispatch` | Headless. Agent notified on completion. Sentinel wrapping for reliable done-detection. | Subagent spawning |
| `monitor` | Headless event monitor. Stream/poll-diff/file-watch triggers. | Log watching, test runners |

## Monitor triggers

```json
{
  "strategy": "stream",
  "triggers": [
    { "id": "fail", "literal": "FAIL" },
    { "id": "error", "regex": "/error|warn/i" },
    { "id": "high-cpu", "regex": "/cpu: (\\d+)%/", "threshold": { "captureGroup": 1, "op": "gt", "value": 90 } }
  ],
  "throttle": { "dedupeExactLine": true, "cooldownMs": 5000 }
}
```

## Run records

All sessions persisted to `~/.pi/agent/pi-dispatch/runs/<recordId>-<launchToken>.json`:
- Created on spawn, updated on state changes, deleted on dismiss
- Retained 7 days by default (`runRetentionDays`)
- In-memory index drives the widget — no disk reads on render

## Configuration

```json
{
  "exitAutoCloseDelay": 10,
  "overlayWidthPercent": 95,
  "overlayHeightPercent": 60,
  "focusShortcut": "alt+shift+f",
  "spawn": {
    "defaultAgent": "pi",
    "commands": { "pi": "pi", "codex": "codex", "claude": "claude", "cursor": "cursor", "gemini": "gemini" },
    "worktree": false,
    "worktreePolicy": "keep"
  },
  "scrollbackLines": 10000,
  "runRetentionDays": 7
}
```

## Limitations

- PTY output limited by scrollback (default 10K lines)
- Monitor mode: poll-diff and file-watch require platform support
- Worktree mode requires clean git state
- Overlay rendering tested at width 120; narrow terminals may truncate footer
