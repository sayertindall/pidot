# pi-runtime-quit-and-delete

Quit pi and permanently delete the active session file. Destructive — requires
explicit shortcut activation, no command equivalent.

## Features

- **One-shot cleanup**: Quit pi and delete the active session JSONL file
- **Shortcut-only**: No tool or command — deliberate activation via `Ctrl+Shift+X`
- **Graceful handling**: Exits cleanly even when session file is null or already gone
- **ENOENT-safe**: Swallows "file already gone" errors
- **Permission error logging**: Writes to stderr on non-ENOENT failures (e.g., permission denied) but still exits

## Structure

```
pi-runtime/quit-and-delete/extensions/quit-and-delete/
└── index.ts          # Extension entry — registers Ctrl+Shift+X shortcut
```

## Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+Shift+X` | Quit pi and permanently delete the active session file |

## Error Handling

| Scenario | Behavior |
|---|---|
| Session file exists | Deletes file, exits with code 0 |
| Session file is null (no session) | Exits with code 0 |
| File already gone (ENOENT) | Exits with code 0, no error |
| Permission denied (EACCES) | Writes error to stderr, exits with code 0 |
| Running as root (uid 0) | Permission test skipped gracefully |

## Safety

- No command or tool — only activatable via keyboard shortcut
- Cannot be triggered accidentally by the model
- Confirmation could be added as a future enhancement

## Limitations

- No undo — deletion is permanent
- No trash/recovery mechanism
- Only one shortcut; no customizeable keybinding
