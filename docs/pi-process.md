# pi-process

Process, pane, and CLI-delegation orchestration. The PTY dispatch engine,
Herdr integation, SSH remote execution, and tmux control — a single control
plane for spawning, monitoring, and managing fleets of agents.

## Sub-packages

| Package | Description |
|---|---|
| `_shared` | Cross-cutting: safeExec, confirmation, RunRecord, paths |
| `pi-dispatch` | PTY dispatch engine — powers `interactive_shell` |
| `pi-herdr` | Herdr TUI integration — layout, pane, agent tools |
| `pi-ssh` | SSH remote execution with confirmation gating |
| `pi-tmux` | tmux pane control |

## Shared resources

All sub-packages use `_shared` for:
- **`safeExec`**: `execFileSync` wrapper with timeout, maxBuffer, error handling. No shell injection. Used by pi-ssh, pi-tmux, pi-herdr.
- **`confirmation`**: Explicit-confirmation helper for destructive operations. Used by pi-ssh.
- **`RunRecord`**: Process run auditing (command, exit code, timing). Used by pi-dispatch.
- **`paths`**: State file layout under `~/.pi/agent/pi-process/<extension>/`.

## Installation

Each sub-package installs independently:
```bash
pi install ./packages/pi-process/pi-dispatch
pi install ./packages/pi-process/pi-herdr
pi install ./packages/pi-process/pi-ssh
pi install ./packages/pi-process/pi-tmux
```
