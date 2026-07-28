# pi-config: Preset

System prompt preset management. Loads presets from global and project markdown
files, applies them via `before_agent_start` hook, and provides in-session
cycling via `Ctrl+Shift+U`.

## Features

- **Global + project presets**: Loads from `~/.pi/agent/pi-config/presets/` and `.pi/presets/`
- **System prompt injection**: `before_agent_start` hook appends or replaces system prompt
- **In-session cycling**: `Ctrl+Shift+U` rotates through available presets
- **Flag support**: `--preset <name>` sets the preset at startup
- **Persistent state**: Active preset remembered across sessions

## Structure

```
pi-config/extensions/preset/
├── index.ts          # Extension entry — /preset command, --preset flag, Ctrl+Shift+U
├── commands.ts       # /preset command (list, enable, disable, cycle)
├── runtime.ts        # Preset application (replace/append modes)
├── state.ts          # Preset loading from global + project dirs
├── ui.ts             # Widget rendering
└── types.ts          # Preset, PresetState
```

## Commands

| Command | Description |
|---|---|
| `/preset list` | List all available presets |
| `/preset enable <name>` | Enable a specific preset |
| `/preset disable` | Disable all presets |
| `/preset cycle` | Cycle to the next preset |

## Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+Shift+U` | Cycle to next preset |

## Flags

| Flag | Description |
|---|---|
| `--preset <name>` | Set active preset at session start |

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Load presets, apply --preset flag or restore persisted state |
| `before_agent_start` | Inject active preset's instructions into system prompt |

## Preset files

Markdown files with YAML frontmatter:

```markdown
---
name: security-focus
mode: append
---

When analyzing code, always consider:
- Authentication and authorization
- Input validation
- Data encryption
```

**Locations:**
- `~/.pi/agent/pi-config/presets/*.md` — Global
- `.pi/presets/*.md` — Project-local

## Limitations

- No preset hot-reload — requires session restart to pick up new files
- `replace` mode discards all existing system prompt content
- No preset composition (no stacking multiple presets)
