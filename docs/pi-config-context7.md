# pi-config: Context7

Library documentation search integration. Provides `search_lib` and `lookup_lib`
tools backed by the Context7 API, plus a `/context7` command for manual use.

## Features

- **Library search**: `search_lib` returns ranked documentation results for a query
- **Library lookup**: `lookup_lib` returns docs for a specific library ID
- **Network-resilient**: Handles empty queries, network errors, rate limits
- **Configurable**: API token and endpoint configurable

## Structure

```
pi-config/extensions/context7/
├── index.ts          # Extension entry — registers tools + /context7 command
├── runtime.ts        # HTTP client for Context7 API
└── types.ts
```

## Tools

| Tool | Description |
|---|---|
| `search_lib` | Search library documentation — returns ranked results |
| `lookup_lib` | Get documentation for a specific library ID |

## Commands

| Command | Description |
|---|---|
| `/context7 search <query>` | Search library docs |
| `/context7 lookup <id>` | Get docs for a library ID |

## API

Tools call the Context7 API with:
- API token (configured via pi config)
- Query string or library ID
- Ranked results with snippets and links

## Error Handling

- **Empty query**: Returns informative error
- **Network error**: Returns error with status
- **Rate limit**: Returns error with retry guidance
- **Invalid library ID**: Returns "not found" error

## Limitations

- Requires network access to Context7 API
- Requires API token configuration
- Results limited to Context7's indexed libraries
