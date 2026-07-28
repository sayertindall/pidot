# Spec: pi-runtime-quit-and-delete

**Source:** `libs/pi-extensions/packages/pi-quit-and-delete/index.ts` (65 lines)
**Target:** `packages/pi-runtime/quit-and-delete/`
**Package kind:** installable, no npm publish (per family rule for pi-runtime)

## What it does

Ctrl+Shift+X (configurable via `PI_QUIT_AND_DELETE_SHORTCUT`, default `ctrl+shift+x`) deletes the current session JSONL file and exits. One `registerShortcut` call. No state, no lifecycle, no I/O to manage. Used when a session went off the rails and the user wants to throw it away and start fresh.

## File split

```
packages/pi-runtime/quit-and-delete/
├── package.json          # name: pi-runtime-quit-and-delete, no LICENSE
├── tsconfig.json         # strict, noUncheckedIndexedAccess, allowImportingTsExtensions
├── vitest.config.ts      # fileParallelism: false
├── README.md             # Short — install, shortcut env var, scope
├── SPEC.md               # this file
├── src/
│   ├── index.ts          # factory
│   └── types.ts          # internal types (small)
└── test/
    └── index.test.ts     # integration
```

## Function contracts

### `src/index.ts`

```typescript
export default function quitAndDeleteExtension(pi: ExtensionAPI): void {
  const shortcut = resolveShortcut();
  pi.registerShortcut(shortcut, {
    description: "Quit pi and permanently delete the active session file",
    handler: async (ctx: ExtensionContext) => { /* ~30 LOC */ },
  });
}
```

The handler:
1. Get `sessionFile = ctx.sessionManager.getSessionFile()`.
2. If non-null, `unlink(sessionFile)` (best-effort, swallow ENOENT).
3. If `unlink` fails for any other reason, write to stderr.
4. `process.exit(0)` — always exit, even on unlink failure.

### `src/types.ts`

```typescript
function isEnoent(err: unknown): boolean;
```

### `resolveShortcut`

Priority:
1. `process.env[ENV_VAR]` if non-empty.
2. `~/.pi/agent/settings.json`'s `extensions["pi-runtime-quit-and-delete"].shortcut` if set.
3. `DEFAULT_SHORTCUT`.

## Tests

- Register the extension; capture the shortcut via `pi.registerShortcut`.
- Build a fake `ctx` with `sessionManager.getSessionFile()` returning a real temp file (`mkdtempSync` + `writeFileSync`).
- Invoke the captured handler.
- Assert: temp file no longer exists; `process.exit` was called with 0.

## Source deltas

- **No LICENSE** (per family rule).
- **No `restoreTerminal`**: not exported from `@earendil-works/pi-coding-agent`. Dropped — terminal state doesn't survive `process.exit`.
- **No `console.log`**.
- **Subprocess calls**: none. `process.exit` is the only thing outside pure JS.
