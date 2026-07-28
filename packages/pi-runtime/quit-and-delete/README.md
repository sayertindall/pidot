# pi-runtime-quit-and-delete

Ctrl+Shift+X deletes the active session JSONL file and exits. Throw away a broken session and start fresh.

## Install

```bash
pnpm add link:packages/pi-runtime/quit-and-delete
```

Then add `pi-runtime-quit-and-delete` to your pi `extensions` config.

## Shortcut

| Source | Value |
|---|---|
| Default | `ctrl+shift+x` |
| Env | `PI_QUIT_AND_DELETE_SHORTCUT` |
| Settings | `~/.pi/agent/settings.json` → `"pi-runtime-quit-and-delete": { "shortcut": "..." }` |

## Scope

Session-lifecycle-aware, no state, no lifecycle hooks, no I/O beyond `unlink`. Listed under `pi-runtime` because it touches the session log itself.

## Behavior

1. Reads the active session file path from the session manager.
2. Unlinks it (best-effort — ENOENT is swallowed).
3. On any other unlink failure, writes the error to stderr.
4. Always calls `process.exit(0)`.
