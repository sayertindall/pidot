# Spec: pi-runtime-worktree

**Source:** `libs/pi-extensions/packages/pi-worktree/index.ts` (260 lines)
**Target:** `packages/pi-runtime/worktree/`
**Package kind:** installable, no npm publish

## What it does

User calls `switch_worktree` (model-invoked tool) or `/switch-worktree <path>` (slash command). The extension validates the target is a real non-bare git working tree, asks the user to confirm, then forks the session JSONL into a new file in the target directory and continues the conversation there. History preserved.

Module-scope boolean `pendingWorktreeSwitch` clears on `input` event (user pressed Enter).

## File split

```
packages/pi-runtime/worktree/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── SPEC.md
├── src/
│   ├── types.ts          # GitWorkingTreeInfo, SwitchWorktreeState
│   ├── validation.ts     # validateGitWorkingTree, displayBranch
│   ├── index.ts          # factory, switch_worktree tool, /switch-worktree command
│   └── state.ts          # pendingWorktreeSwitch flag + helpers
└── test/
    ├── validation.test.ts
    └── index.test.ts
```

`index.ts` is ~190 LOC (tool + command handlers), `validation.ts` ~80 LOC, the rest under 50.

## Function contracts

### `src/validation.ts`

```typescript
export interface GitWorkingTreeInfo {
  branch?: string;
  detectedBranch?: string;  // raw, with refs/heads/ prefix (used to check detaching)
}

export async function validateGitWorkingTree(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<GitWorkingTreeInfo>;

export function displayBranch(branch?: string): string;
```

`validateGitWorkingTree` runs three `pi.exec("git", [...])` calls:
1. `rev-parse --is-inside-work-tree` — must be "true".
2. `rev-parse --is-bare-repository` — must NOT be "true".
3. `symbolic-ref -q HEAD` — best-effort, returns detached if absent.

Each call has 5s timeout and passes `signal`. On any failure, throw a descriptive `Error`.

`displayBranch(branch)` strips `refs/heads/` prefix. Returns `"(detached)"` if no branch.

### `src/state.ts`

```typescript
let pendingWorktreeSwitch = false;

export function isPendingWorktreeSwitch(): boolean;
export function setPendingWorktreeSwitch(value: boolean): void;

export function blockForWorktreeSwitch(pi: ExtensionAPI, ctx: ExtensionContext): void;
export function clearWorktreeBlock(pi: ExtensionAPI, ctx: ExtensionContext): void;
```

`blockForWorktreeSwitch`: sets the flag, calls `ctx.ui.setStatus("worktree", "switch pending — press Enter")`, and emits `pi.events.emit("herdr:blocked", { active: true, label: "press Enter to switch worktree" })` if `process.env.HERDR_ENV`.

`clearWorktreeBlock`: clears the flag, calls `ctx.ui.setStatus("worktree", undefined)`, and emits `pi.events.emit("herdr:blocked", { active: false })` if `process.env.HERDR_ENV`.

### `src/index.ts`

Two registrations:

1. **Tool `switch_worktree`**: parameter `path: string`. Validates the target, sets `ctx.ui.setEditorText("/switch-worktree <canonical>")`, calls `blockForWorktreeSwitch`, returns the validation result + an instruction to the user.

2. **Command `/switch-worktree <path>`**: parses the path, calls `validateGitWorkingTree`, asks for confirmation via `ctx.ui.confirm`, then:
   - `SessionManager.forkFrom(currentFile, canonicalTarget)` to get a new file.
   - Strip `parentSession` from the new file's header (avoid dangling reference after the old file is unlinked).
   - `ctx.switchSession(newFile, { withSession: async (newCtx) => { unlink currentFile; clearWorktreeBlock; sendUserMessage("Session relocated to worktree: <path>. Continue working."); } })`.

The factory also registers an `input` event handler: when the source is `interactive` and `pendingWorktreeSwitch` is true, call `clearWorktreeBlock`.
