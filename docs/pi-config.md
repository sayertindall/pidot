# pi-config

Central configuration extension bundle. Seven subsystems share a common state
store under `~/.pi/agent/pi-config/`.

## Sub-packages

| Subsystem | Description | Docs |
|---|---|---|
| Safety | Dangerous command detection + blocking | [pi-config-safety.md](pi-config-safety.md) |
| Review | Code review in fresh session branch | [pi-config-review.md](pi-config-review.md) |
| Enhance | Prompt rewriting engine with presets | [pi-config-enhance.md](pi-config-enhance.md) |
| Preset | System prompt preset management | [pi-config-preset.md](pi-config-preset.md) |
| Context7 | Library documentation search | [pi-config-context7.md](pi-config-context7.md) |
| Status | Status line display (model, tokens, branch) | [pi-config-status.md](pi-config-status.md) |

## Features

- **Safety**: Blocks dangerous shell commands (`rm -rf`, `sudo`, `curl | bash`, `chmod 777`)
- **Review**: Code review in a fresh git branch — uncommitted changes, branch diff, commit, or PR
- **Enhance**: Prompt rewriting engine with presets, persistence, and conversation-aware context injection
- **Preset**: Load system prompt presets from global and project markdown files
- **Context7**: Library documentation search via `search_lib` / `lookup_lib` tools
- **Status**: Status line display — provider, model, thinking level, token usage
- **Persistent config**: All state stored under `~/.pi/agent/pi-config/<feature>/`

## Structure

```
pi-config/extensions/
├── index.ts              # Wiring — imports all subsystems
├── _shared/              # State store, IO, widget base, TypeBox validators
├── safety/               # Dangerous command detection + blocking
│   ├── index.ts          # Extension entry
│   ├── runtime.ts        # Command pattern matching + session hook
│   ├── patterns.ts       # Regex patterns for dangerous commands
│   └── types.ts
├── review/               # Code review launch in fresh branch
│   ├── index.ts          # /review, /end-review commands
│   ├── commands.ts       # Argument parser
│   ├── selectors.ts      # Interactive target picker (branch/commit/PR)
│   ├── targets.ts        # Git helpers: branches, commits, PR info
│   ├── runtime.ts        # Review session lifecycle
│   ├── state.ts          # Session-scoped state (base64url session ID)
│   └── types.ts          # ReviewRecord, ReviewTarget, ReviewStatus
├── enhance/              # Prompt rewriting engine
│   ├── index.ts          # /enhance command, enhance_prompt tool, Ctrl+Shift+E
│   ├── runtime.ts        # enhancePrompt() — calls model with preset system prompt
│   ├── commands.ts       # /enhance arg parser (on/off/preset/list/rewrite)
│   ├── state.ts          # Preset loading from ~/.pi/agent/pi-config/enhance/presets/
│   └── types.ts          # EnhancePreset, EnhanceState
├── preset/               # System prompt preset management
│   ├── index.ts          # /preset command, --preset flag, Ctrl+Shift+U shortcut
│   ├── state.ts          # Preset loading from global + project dirs
│   ├── runtime.ts        # Preset application (replace/append modes)
│   └── types.ts
├── context7/             # Context7 library search integration
│   ├── index.ts          # /context7 command, search_lib + lookup_lib tools
│   ├── runtime.ts        # HTTP client for context7 API
│   └── types.ts
└── status/               # Status line + /status command
    ├── index.ts          # Widget hook on session_start/session_shutdown
    ├── runtime.ts        # Token counting, provider/model/thinking extraction
    ├── widget.ts         # TUI status line rendering
    └── types.ts
```

## Tools

| Tool | Subsystem | Description |
|---|---|---|
| `enhance_prompt` | enhance | Rewrite a prompt using the active preset |
| `search_lib` | context7 | Search library documentation |
| `lookup_lib` | context7 | Get docs for a specific library ID |
| `get_goal` | (in pi-runtime) | Get current goal state |

## Commands

| Command | Subsystem | Description |
|---|---|---|
| `/review` | review | Start code review (`uncommitted`, `branch <name>`, `commit <sha>`, `pr <num>`) |
| `/end-review` | review | End current review session |
| `/enhance` | enhance | Manage prompt enhancement (`on`, `off`, `preset <name>`, `list`, `rewrite`) |
| `/preset` | preset | List, enable, disable system prompt presets |
| `/context7` | context7 | Search library documentation |
| `/status` | status | Show detailed provider/model/token info |

## Shortcuts

| Shortcut | Subsystem | Description |
|---|---|---|
| `Ctrl+Shift+E` | enhance | Rewrite current editor text with active preset |
| `Ctrl+Shift+Z` | enhance | Undo last enhance rewrite |
| `Ctrl+Shift+U` | preset | Cycle to next preset |

## Flags

| Flag | Subsystem | Description |
|---|---|---|
| `--preset <name>` | preset | Set active preset at startup |

## Hooks

| Hook | Subsystem | What it does |
|---|---|---|
| `session_start` | safety, review, enhance, preset, status | Restore state, set widget, load presets |
| `session_shutdown` | review, enhance, status | Clean up widgets |
| `before_agent_start` | enhance, preset | Inject system prompt from active preset |

## Presets (enhance)

User-authored markdown files with YAML frontmatter:

```markdown
---
name: security-review
mode: append
description: Adds security analysis instructions
---

When reviewing code, always check for:
- SQL injection
- XSS vulnerabilities
- Insecure deserialization
...
```

**Locations:**
- `~/.pi/agent/pi-config/enhance/presets/*.md` — global presets
- `.pi/enhance/presets/*.md` — project presets

**Modes:**
- `append` — add to existing system prompt
- `replace` — replace entire system prompt

## Configuration

All state stored under `~/.pi/agent/pi-config/`:
- `safety/state.json` — blocked commands history
- `review/<base64url(session_id)>/state.json` — per-session review state
- `enhance/state.json` — active preset + undo state
- `enhance/presets/*.md` — user-authored presets
- `preset/state.json` — active preset selection
- `status/` — status widget state

## Limitations

- Safety: only matches regex patterns — cannot detect obfuscated commands
- Review: requires `gh` CLI for PR checkout, `git` for all operations
- Enhance: conversation context limited to last 8 messages (configurable)
- Context7: requires network access to context7 API
