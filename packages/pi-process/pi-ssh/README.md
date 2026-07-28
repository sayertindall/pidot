# pi-ssh

Explicit SSH command execution for the Pi coding agent. Highest-privilege thing in the package: confirmation required, every invocation logged.

## Commands (planned)

| Command | What it does |
|---|---|
| `/ssh-add <alias> <user@host>` | Store a host alias (always requires confirmation) |
| `/ssh <alias> <command...>` | Run a command on a stored alias (requires confirmation per call) |
| `/ssh-list` | Show stored aliases |
| `/ssh-history [N]` | Last N invocations |

## State

- `~/.pi/agent/pi-process/pi-ssh/aliases.json` — named host aliases
- `~/.pi/agent/pi-process/pi-ssh/history.jsonl` — every invocation logged

## Status: scaffold

This package is currently a scaffold. The extension factory is registered; no commands are wired yet. See `PI-PROCESS-IMPL-SPEC.md` for the design.

## Installation

```sh
pi install ./packages/pi-process/pi-ssh
```

## License

MIT
