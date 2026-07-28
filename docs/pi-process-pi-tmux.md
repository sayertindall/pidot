# pi-tmux

Thin tmux wrapper. Passes commands through to the `tmux` CLI binary via `safeExec`.

## Features

- **Pane operations**: Create, split, kill, select panes
- **Inside/outside detection**: Adapts behavior based on whether pi is running inside tmux
- **Safe execution**: All tmux commands route through `safeExec` (timeout, maxBuffer, no shell injection)

## Structure

```
pi-tmux/extensions/tmux/
├── index.ts          # Extension entry — registers tmux tool + session hook
├── pane-ops.ts       # Pane creation, splitting, killing
└── types.ts
```

## Tools

| Tool | Description |
|---|---|
| `tmux` | Execute tmux commands (pane operations) |

## Commands

No commands registered — all interaction through the `tmux` tool.

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Detect inside/outside tmux, set up environment |

## Limitations

- Requires `tmux` binary installed on the host
- Single pane operations only — no session/window management
- No widget or UI
