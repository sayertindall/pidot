# pi-toolkit-tilldone

Togglable task discipline — agent must define tasks before using other tools.

## What it does

Off by default. `/tasks on` enables strict task discipline: agent must call `tilldone add` to define tasks before using other tools, must set one to `in_progress` before running anything, and can only mark `done` if a gate (e.g., a test command) passes. Persistent widget shows current task below the editor. Status line shows progress. Auto-nudge when agent finishes with incomplete tasks.

## Install

```bash
pi install ./packages/pi-toolkit/tilldone
```

## Commands

| Command | Description |
|---|---|
| `/tasks` | Toggle task mode on/off |
| `/tasks on` | Enable task discipline |
| `/tasks off` | Disable and clear tasks |
| `/tasks status` | Show current state |

## Tool

| Action | Description |
|---|---|
| `tilldone add` | Add one or more tasks (pass `text` or `texts[]`) |
| `tilldone done` | Mark a task done (runs gate command if present) |
| `tilldone next` | Advance current task to done, next idle → inprogress |
| `tilldone prev` | Move current task back to idle, previous → inprogress |
| `tilldone list` | Show all tasks |
| `tilldone clear` | Remove all tasks |
| `tilldone update` | Change task text or status |

## License

MIT.
