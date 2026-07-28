# pi-runtime-worktree

Relocate the active pi session to another git working tree while preserving conversation history.

## Usage

### Slash command

```
/switch-worktree <path>
```

Validates the target is a real non-bare git working tree, asks for confirmation, forks the session JSONL into a new file in the target directory, and continues the conversation there.

### Model-invoked tool

The model can call `switch_worktree` with a `path` parameter. The tool validates the target, prefills the editor with the slash command, and instructs the user to press Enter to complete the relocation.

## How it works

1. Validates the target directory is inside a non-bare git working tree (via `git rev-parse`)
2. Detects the current branch (best-effort; works on detached HEAD too)
3. Asks for user confirmation
4. Forks the current session JSONL into the new directory
5. Strips the `parentSession` header field to avoid dangling references
6. Switches the session context to the new file
7. Cleans up the original session file and notifies the user

## Package layout

```
src/
├── index.ts        # Extension factory: tool + command registrations
├── types.ts        # GitWorkingTreeInfo, SwitchWorktreeState
├── validation.ts   # validateGitWorkingTree, displayBranch
└── state.ts        # pendingWorktreeSwitch flag + Herdr integration
test/
├── validation.test.ts
└── index.test.ts
```
