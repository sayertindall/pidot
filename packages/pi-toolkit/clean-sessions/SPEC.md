# pi-toolkit-clean-sessions

Two-step safe session pruning for Pi.

## Commands

- `/clean-sessions [days]` — find sessions older than N days (default 30) with fewer than 12 JSONL lines AND matching the auto-name pattern (or no name). Always dry-run first.
- `/empty-session-trash` — permanently delete the contents of `.trash/`.

## Safety

- Only operates inside `~/.pi/agent/sessions` (path-verified)
- Only moves `.jsonl` files, never directories
- Moves to `.trash/<timestamp>/` preserving directory structure
- Requires typing the exact count to confirm
- Sessions with short, manually-chosen names (no date prefix) are always exempt
- MOVE-LOG.json is stored at `~/.pi/agent/pi-toolkit/clean-sessions/log/<timestamp>.json`
