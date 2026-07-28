# pi-runtime-worktree

Git worktree management for isolated agent execution. Creates, validates, and
switches git worktrees without polluting the main working directory.

## Features

- **Worktree creation**: Creates git worktree with validation — rejects bare repos, non-git dirs, paths outside worktree
- **Session relocation**: `switch_worktree` tool moves the active session to a worktree
- **Input hook**: Captures `{worktree}` in user input, offers to create a worktree
- **Validation**: Rejects bare repos, non-git directories, paths outside worktree — prevents bad git states

## Structure

```
pi-runtime/worktree/extensions/worktree/
├── index.ts          # Extension entry — registers tool, command, input hook
├── validation.ts     # Worktree path validation
└── types.ts
```

## Tools

| Tool | Description |
|---|---|
| `switch_worktree` | Move active session to a git worktree |

## Commands

| Command | Description |
|---|---|
| `/switch-worktree` | Create or switch to a git worktree |

## Hooks

| Hook | What it does |
|---|---|
| `input` | Detects `{worktree}` in user input, offers to create worktree |

## Validation rules

- Rejects bare repos (no working tree to branch from)
- Rejects non-git directories (no `.git` directory)
- Rejects paths outside the main worktree (safety boundary)
- Handles existing worktrees (refuses to overwrite)

## Limitations

- Requires git 2.5+ (worktree support)
- Only one worktree per session
- Worktree path must be within the same filesystem
