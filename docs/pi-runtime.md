# pi-runtime

Runtime extensions — session-bound utilities that affect the active conversation.

## Sub-packages

| Package | Description |
|---|---|
| `goal` | Goal tracking — create, update, complete goals with handoff prompts |
| `notrace` | Generate self-contained HTML session reports |
| `worktree` | Git worktree management — create, switch, validate |
| `quit-and-delete` | Quit pi and permanently delete the active session file |

## Shared pattern

All runtime extensions:
- Register hooks on `session_start` / `session_shutdown`
- Use `ctx.sessionManager` for session state
- Follow the "no root pollution" rule — state under `~/.pi/agent/pi-runtime/<extension>/`
