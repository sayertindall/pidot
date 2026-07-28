# pi-config: Enhance

Prompt rewriting engine. Takes user text, sends it to the active model with a
preset system prompt, and returns a clarified/improved version. Provides two
pathways: a user-facing rewrite shortcut and a background system prompt injector.

## Features

- **One-button rewrite**: `Ctrl+Shift+E` rewrites editor text with active preset
- **AI-callable tool**: `enhance_prompt` lets the model rewrite prompts mid-conversation
- **System prompt injection**: `before_agent_start` hook adds preset instructions to every turn
- **Conversation-aware**: Injects recent context from `ctx.sessionManager.getBranch()` so the model resolves implicit references
- **Undo**: `Ctrl+Shift+Z` restores original text
- **Presets**: User-authored markdown files with YAML frontmatter in `~/.pi/agent/pi-config/enhance/presets/`
- **Persistent state**: Active preset remembered across sessions in `state.json`

## Structure

```
pi-config/extensions/enhance/
├── index.ts          # Extension entry — /enhance, enhance_prompt tool, shortcuts
├── runtime.ts        # enhancePrompt() — calls model with preset system prompt
├── commands.ts       # /enhance arg parser (on/off/preset/list/rewrite)
├── state.ts          # Preset loading from ~/.pi/agent/pi-config/enhance/presets/
├── ui.ts             # Widget rendering
├── schemas.ts        # TypeBox schema for enhance_prompt params
└── types.ts          # EnhancePreset, EnhanceState
```

## Tools

| Tool | Description |
|---|---|
| `enhance_prompt` | Rewrite a prompt using the active preset (or one passed inline) |

Tool parameters:
```json
{ "text": "the prompt to rewrite", "preset": "optional-preset-name" }
```

## Commands

| Command | Description |
|---|---|
| `/enhance on` | Enable enhancement with first available preset |
| `/enhance off` | Disable enhancement |
| `/enhance preset <name>` | Switch to a specific preset |
| `/enhance list` | List all available presets |
| `/enhance rewrite` | Rewrite current editor text with active preset |

## Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+Shift+E` | Rewrite current editor text with active preset |
| `Ctrl+Shift+Z` | Undo last enhance rewrite |

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Load presets, restore active preset from state |
| `session_shutdown` | Clean up widget |
| `before_agent_start` | Inject preset system prompt (append or replace mode) |

## Presets

User-authored markdown files with YAML frontmatter:

```markdown
---
name: default
mode: append
description: Standard prompt enhancement
---

You rewrite user prompts to be clearer, more specific, and more actionable.
Preserve ALL implicit references — "the command above", "that error", etc.
Do NOT add new requests or ask clarifying questions.
Output ONLY the rewritten prompt. No preamble.
```

**Locations:**
- `~/.pi/agent/pi-config/enhance/presets/*.md`

**Modes:**
- `append` — add to existing system prompt
- `replace` — replace entire system prompt

## Conversation context

When called via any pathway, `extractRecentContext(ctx)` pulls the last 8
user/assistant messages from the session branch and prepends them so the
rewriter can resolve references like "the command above" or "that error."

## Limitations

- Context limited to last 8 messages (tunable in `extractRecentContext`)
- Preset `replace` mode discards all previous system prompt instructions
- No built-in presets — users must create at least one `.md` file
