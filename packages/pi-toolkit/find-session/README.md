# pi-toolkit-find-session

Search saved Pi sessions with ripgrep and resume a match.

## What it does

You remember working on something last week but you don't remember which session. Run `/find-session <query>`. The extension runs `rg --json` across `~/.pi/agent/sessions/`, opens a scrollable list of matching sessions, and on Enter resumes into the selected one.

```
> /find-session auth rate limiter

┌──────────────────────────────────────────────────────────────────────────────┐
│ find-session                                                                 │
│ project-x  session-1:42  auth rate limiter middleware                        │
│   auth rate limiter middleware                                               │
│ 1 match · ↑↓ move · PgUp/PgDn jump · Enter resume · Esc cancel               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Requirements

- `rg` (ripgrep) on `$PATH`. If missing, the extension falls back to a `readdir` + per-file substring search.
- Pi-compatible session storage at `~/.pi/agent/sessions/`.

## Install

```bash
pi install ./packages/pi-toolkit/find-session
```

## Commands

| Command | Description |
|---|---|
| `/find-session <query>` | Search past sessions for `<query>`, pick a match, resume. |

## Behavior

- Search is case-insensitive and treats the query as literal text (no regex metacharacter footguns).
- Results are sorted by match count per file (most matches first), then by path.
- Capped at 50 results.
- The first matched line per file is shown as the preview.
- Sessions with no matches are not shown.

## License

MIT.
