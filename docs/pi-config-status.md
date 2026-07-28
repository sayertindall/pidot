# pi-config: Status

Status line display showing provider, model, thinking level, and token usage.
Rendered as a TUI widget below the editor, updated on model switch and turn end.

## Features

- **Provider + model display**: Shows active provider and model name
- **Thinking level**: Displays current thinking level (off/minimal/low/medium/high/xhigh)
- **Token usage**: Current context token count and percentage
- **Git branch**: Active git branch (when available)
- **Auto-update**: Refreshes on model switch and agent settled events
- **TUI widget**: Rendered below the editor via `ctx.ui.setWidget`

## Structure

```
pi-config/extensions/status/
├── index.ts          # Extension entry — /status command + widget hook
├── runtime.ts        # Token counting, provider/model/thinking extraction
├── widget.ts         # TUI status line rendering
└── types.ts          # StatusState
```

## Commands

| Command | Description |
|---|---|
| `/status` | Show detailed status (provider, model, tokens, branch, session info) |

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Mount status widget |
| `session_shutdown` | Remove status widget |

## Widget

The status widget renders a single line below the editor:

```
⚡ anthropic/claude-sonnet-4 · thinking: high · 45K/200K (22%) · main
```

| Segment | Source |
|---|---|
| Provider/model | `ctx.model` |
| Thinking level | `ctx.model.thinking` |
| Token count | `ctx.sessionManager.getBranch()` walk or `pi_getSessionInfo()` |
| Git branch | `pi_getSessionInfo().gitBranch` |

## Limitations

- Widget width constrained by terminal columns — truncates gracefully
- Token counting is approximate (walks session branch entries)
- Requires `ctx.hasUI` to render widget
