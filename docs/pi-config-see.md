# pi-config: See

Vision delegation for text-only models. Registers a single `see` tool that
shells out to the Codex CLI with a vision-capable model (default
`gpt-5.6-luna` via the `openai-codex` provider) and returns a text
description the active model can reason over.

Use when the active model cannot process images (e.g. `deepseek-v4-flash`
declares `input: ["text"]`, so pi's `read` tool omits image attachments) or
when a screenshot, mockup, diagram, or photo needs precise visual reading.

## Features

- **Single tool**: `see(paths, prompt?, model?)` — returns description as text
- **Zero-config**: uses the installed Codex CLI and the `openai-codex` provider
- **Safe**: runs codex with the `read-only` sandbox, no repo checks
- **Reliable**: missing files and non-zero exits surface as tool errors; 3-minute
  timeout with abort support

## Structure

```
pi-config/extensions/see/
├── index.ts          # Extension entry — registers the see tool
├── runtime.ts        # describeImage() — spawns codex exec with image(s)
└── schemas.ts        # TypeBox schema for see params
```

## Tools

| Tool  | Description |
|---|---|
| `see` | Look at an image with a vision model and return a text description |

## Cost

`gpt-5.6-luna` on the `openai-codex` provider: ~$0.20 / $1.20 per M tokens —
a typical screenshot inspection costs a fraction of a cent.
