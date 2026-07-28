# pi-toolkit-coach

LLM-powered deep analysis of Pi session habits and workflow coaching.

## What it does

Run `/coach` to get a personalized coaching report analyzing HOW you use Pi. The extension reads your actual session content (user messages, tool calls, file paths, session structure), sends the collected evidence to the active model with a coaching prompt, and displays a markdown report with specific, evidence-backed recommendations.

This is intentionally slow and expensive. Quality over speed.

```
> /coach

┌─ Coach scope ───────────────────────────────────────────────────────────────────┐
│  Current session           Analyze this live conversation only                   │
│  All sessions in this      Deep analysis of all session history                  │
│  working directory         (This will take longer and use tokens)                │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Use `/coach last` to reopen the most recent report from the current session.

## Install

```bash
pi install ./packages/pi-toolkit/coach
```

## Commands

| Command | Description |
|---|---|
| `/coach` | Analyze session(s) and produce a coaching report |
| `/coach last` | Reopen the last coaching report from this session |

## Requirements

- An active model selected in Pi.

## License

MIT.
