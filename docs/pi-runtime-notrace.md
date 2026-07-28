# pi-runtime-notrace

Generate self-contained HTML session reports with embedded conversation data.

## Features

- **Notrace block extraction**: Pulls notrace template blocks from conversation
- **Template rendering**: Expands templates with session/model/provider metadata
- **HTML output**: Self-contained, shareable HTML reports
- **Subcommands**: Multiple output formats via `/notrace` subcommands
- **File I/O**: Reads/writes notrace files, handles missing directories and permission errors

## Structure

```
pi-runtime/notrace/extensions/notrace/
├── index.ts          # Extension entry — registers /notrace command
├── command.ts        # Command handler + subcommand routing (generate, template, extract)
├── template.ts       # Template expansion engine
├── extract.ts        # Notrace block extraction from conversation
├── io.ts             # File I/O operations
└── render.ts         # HTML rendering
```

## Commands

| Command | Description |
|---|---|
| `/notrace` | Generate reports, extract blocks, manage templates |

### Subcommands

| Subcommand | Description |
|---|---|
| `generate` | Generate a full HTML session report |
| `extract` | Extract notrace blocks from the conversation |
| `template` | Manage notrace templates |

## Output

Generated reports include:
- Session metadata (ID, date, duration)
- Model and provider info
- Full conversation transcript
- Token usage statistics

## Limitations

- HTML reports are single-file — no external assets
- Template engine limited to session/model metadata variables
- Requires a conversation with content to generate reports
