# pi-tmux

Thin tmux wrapper for the Pi coding agent. Tmux is the state; this is the command surface.

## Commands (planned)

| Command | What it does |
|---|---|
| `/tmux new <session>` | Create a named session |
| `/tmux kill <session>` | Kill a session |
| `/tmux send <session> <cmd>` | Send a command to a session |
| `/tmux list` | List active sessions |
| `/tmux status` | Show last command's exit code |

## Status: scaffold

This package is currently a scaffold. The extension factory is registered; no commands are wired yet. See `PI-PROCESS-IMPL-SPEC.md` for the design.

## Installation

```sh
pi install ./packages/pi-process/pi-tmux
```

## License

MIT
