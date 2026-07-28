# pi-herdr

Herdr TUI integration. Three model-invoked tools gated on `HERDR_ENV=1` +
`HERDR_PANE_ID` — the extension activates only inside a Herdr terminal session.

## Features

- **Layout control**: Create/inspect workspaces, tabs, and panes
- **Pane execution**: Run shell commands, send keys, read output, wait for patterns
- **Agent lifecycle**: Start, prompt, wait, and read recognized coding agents (pi, claude, codex, cursor, gemini, and 15+ others)
- **Safety gate**: Refuses to close the caller's own pane — no self-destruction
- **Output snapshot**: Read pane output as text or ANSI, with scrollback

## Structure

```
pi-herdr/extensions/herdr/
├── index.ts          # Extension entry — registers 3 tools + session hook
└── test/
    └── index.test.ts
```

## Tools

| Tool | Description |
|---|---|
| `herdr_layout` | Create and inspect workspace/tab/pane topology |
| `herdr_pane` | Run commands, send keys, read/wait for output |
| `herdr_agent` | Start, prompt, wait, read coding agents |

### herdr_layout actions

| Action | Description |
|---|---|
| `current` | Get current workspace/tab/pane IDs |
| `workspace_list` | List all workspaces |
| `workspace_create` | Create a new workspace with root pane |
| `tab_list` | List tabs in a workspace |
| `tab_create` | Create a new tab with root pane |
| `pane_list` | List panes in a tab |
| `pane_layout` | Get pane geometry/layout |
| `pane_split` | Split a pane (`right` or `down`) |

### herdr_pane actions

| Action | Description |
|---|---|
| `get` | Get pane info |
| `run` | Run a shell command |
| `read` | Read output (visible, recent, recent-unwrapped, detection) |
| `wait_output` | Wait for literal or regex match in output |
| `send_text` | Send literal text (no Enter) |
| `send_keys` | Send terminal keys (up, down, enter, ctrl+c, etc.) |
| `close` | Close a pane (refuses caller's own pane) |

### herdr_agent actions

| Action | Description |
|---|---|
| `list` | List all recognized agents |
| `start` | Start a coding agent in an existing shell pane |
| `prompt` | Send a prompt (with optional wait for settlement) |
| `wait` | Wait for agent lifecycle state (idle/done/blocked) |
| `read` | Read agent output |
| `send_keys` | Send UI keys (esc, enter, ctrl+c) |
| `focus` | Focus the agent's pane |
| `rename` | Rename the agent |

### Supported agent kinds

`pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`,
`mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`,
`hermes`, `kilo`, `qodercli`, `maki`

## Environment

| Variable | Required | Description |
|---|---|---|
| `HERDR_ENV` | Yes | Must be `"1"` to activate |
| `HERDR_PANE_ID` | Yes | Caller's pane ID |

## Safety

- `herdr_pane({ action: "close" })` on the caller's own pane throws `"Refusing to close"` — prevents self-destruction

## Limitations

- Only activates inside Herdr terminal sessions
- Agent lifecycle: `start` requires an existing available shell pane (use `herdr_layout` first)
- Read output truncated to 2000 lines / 50KB
