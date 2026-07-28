# pi-toolkit-clean-sessions

Prune old, low-value Pi session files safely.

## Installation

```bash
pi install pi-toolkit-clean-sessions
```

## Usage

```
/clean-sessions [days]
```

Scans `~/.pi/agent/sessions/` for sessions older than N days (default 30)
with fewer than 12 lines that are auto-named or unnamed. Shows candidates
first (dry-run), then asks you to type the count to confirm the move.

```
/empty-session-trash
```

Permanently deletes all sessions in `.trash/`. Also requires confirmation.

## Safety

- Never touches manually-named sessions
- Moves to `.trash/<timestamp>/` (not permanent delete)
- Preserves directory structure for easy restoration
- Path-verified to only operate inside `~/.pi/agent/sessions`
- Require typing the exact count to confirm destructive actions
