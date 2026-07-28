# pi-config: Safety

Blocks dangerous shell commands via a `tool_call` hook that inspects bash
executions against configurable regex patterns.

## Features

- **Pattern matching**: Regex patterns detect dangerous commands (`rm -rf`, `sudo`, `chmod 777`, `curl | bash`, etc.)
- **Blocking**: Dangerous commands blocked before execution
- **Confirmation flow**: Optionally require confirmation instead of hard block
- **Configurable rules**: Patterns loaded from `safety.json`, reloadable at runtime via `/safety reload`
- **Tool call hook**: Intercepts `bash` tool calls — no false negatives on known-dangerous patterns

## Structure

```
pi-config/extensions/safety/
├── index.ts          # Extension entry — wires tool_call hook + /safety command
├── commands.ts       # /safety command (status, reload, disable)
├── runtime.ts        # bindToolCallHook — inspects bash commands against patterns
├── state.ts          # readSafetyConfig from ~/.pi/agent/pi-config/safety/
├── patterns.ts       # Regex patterns for dangerous commands
└── types.ts
```

## Commands

| Command | Description |
|---|---|
| `/safety` | Show safety status, rules, recent blocks |
| `/safety reload` | Reload safety.json config |
| `/safety disable` | Temporarily disable safety checks |

## Hooks

| Hook | What it does |
|---|---|
| `tool_call` | Inspects bash tool calls against safety patterns |
| `session_start` | Reloads safety config |

## Configuration

`safety.json` under `~/.pi/agent/pi-config/safety/`:

```json
{
  "rules": [
    { "pattern": "rm\\s+-rf\\s+/", "action": "block", "message": "Recursive root delete blocked" },
    { "pattern": "sudo\\s+", "action": "confirm", "message": "sudo requires confirmation" }
  ],
  "enabled": true
}
```

| Field | Description |
|---|---|
| `rules` | Array of pattern/action/message tuples |
| `enabled` | Master switch — `false` to disable all safety checks |

## Limitations

- Only regex matching — cannot detect obfuscated or encoded commands
- Only hooks `tool_call` for `bash` — other execution paths (e.g., `interactive_shell`) not covered
- Patterns must be manually maintained
