# pi-ssh

Explicit SSH remote execution with confirmation gating. Every command requires
user confirmation before it runs.

## Features

- **Profile loading**: SSH profiles from `~/.ssh/config` and pi config
- **Remote execution**: Commands execute on remote host, output captured, exit codes propagated
- **Safety gate**: Destructive commands require explicit confirmation
- **Path translation**: Local paths translated to remote paths, home directory expansion
- **4 tools**: Read, write, edit, and bash execution on remote targets

## Structure

```
pi-ssh/extensions/ssh/
├── index.ts          # Extension entry — registers 4 tools + /ssh command
├── profiles.ts       # SSH profile loading + parsing
├── path-utils.ts     # Path translation (local ↔ remote)
├── remote-ops.ts     # Remote execution logic
└── session.ts        # Session management
```

## Tools

| Tool | Description |
|---|---|
| `ssh_read` | Read a file on the remote host |
| `ssh_write` | Write content to a file on the remote host |
| `ssh_edit` | Edit a file on the remote host |
| `ssh_bash` | Execute a bash command on the remote host |

## Commands

| Command | Description |
|---|---|
| `/ssh` | SSH profile selection, command execution |

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Load profiles, set default target |
| `before_agent_start` | Inject SSH context into system prompt |

## Configuration

Profiles loaded from:
- `~/.ssh/config` — standard SSH config
- `~/.pi/agent/pi-process/pi-ssh/profiles.json` — pi-specific overrides

## Confirmation

High-privilege commands require user confirmation via `confirmOrThrow` (from `_shared`). Timeout and cancel supported.

## Limitations

- No multiplexed sessions — each command is a new SSH connection
- Requires SSH key or password configured in `~/.ssh/config`
- Path translation assumes POSIX remote
