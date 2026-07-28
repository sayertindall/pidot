# pi-memory

Cache-friendly tiered compaction with observations, reflections, and a dropper
pool. Replaces pi's built-in compaction with a V3 memory model that observes the
conversation, reflects on observations, and drops low-value entries.

## Features

- **Tiered compaction**: Observe → Reflect → Drop pipeline
- **Ratio-based threshold**: Compaction triggers at 68% of model's context window (default), auto-scaling to any model size
- **Observation extraction**: Observer agent reads recent entries, extracts facts as stable 12-char hex IDs
- **Reflection synthesis**: Reflector agent merges observations, tracks state changes, preserves user assertions
- **Dropper pool**: Evicts observations when pool exceeds max tokens, never drops observations still referenced by live reflections
- **Session ledger**: `/om:view` renders fold/unfold summaries with observation/reflection counts
- **Recall tool**: `recall_observation` finds observations/reflections by ID with source context
- **V3 config**: Compact-after-tokens with calibrated or ratio mode; passive mode via `PI_MEMORY_PASSIVE` env
- **Consolidation trigger**: Observer → Reflector → Dropper sequence with debounce and error isolation

## Structure

```
pi-memory/extensions/memory/
├── index.ts                    # Extension entry — wires hooks, commands, tools
├── runtime.ts                  # Runtime orchestrator
├── config.ts                   # V3 config loading, defaults, resolveCompactAfterTokens
├── hooks/
│   ├── compaction-hook.ts      # Hook: produces om.folded details for pi compaction
│   ├── compaction-trigger.ts   # Trigger: fires compaction based on compactAfterTokens
│   └── consolidation-trigger.ts # Trigger: fires observe→reflect→drop chain
├── agents/
│   ├── observer/
│   │   └── agent.ts            # Observer agent: extracts observations from conversation
│   ├── reflector/
│   │   └── agent.ts            # Reflector agent: synthesizes reflections from observations
│   └── dropper/
│       └── agent.ts            # Dropper agent: evicts low-value observations
├── commands/
│   ├── status.ts               # /om:status — show memory pool stats
│   └── view.ts                 # /om:view — session ledger UI
├── tools/
│   └── recall-observation.ts   # recall_observation tool — retrieve by ID
└── session-ledger/             # Entry folding/unfolding, relevance scoring
```

## Tools

| Tool | Description |
|---|---|
| `recall_observation` | Find observation/reflection by ID, returns source context |

## Commands

| Command | Description |
|---|---|
| `/om:status` | Show memory pool stats (observations, reflections, tokens, drops) |
| `/om:view` | Session ledger UI — fold/unfold entries, summaries, counts |

## Hooks

| Hook | What it does |
|---|---|
| Compaction hook | Produces `om.folded` details during pi compaction |
| Compaction trigger | Fires compaction when token threshold reached |
| Consolidation trigger | Fires observer → reflector → dropper pipeline |

## Configuration

```json
{
  "pi-memory": {
    "observeAfterTokens": 10000,
    "reflectAfterTokens": 20000,
    "compactAfterTokens": 81000,
    "compactAfterTokensMode": "ratio",
    "compactAfterTokensRatio": 0.68,
    "observationsPoolMaxTokens": 20000,
    "observationsPoolTargetTokens": 10000,
    "agentMaxTurns": 16,
    "showWorkerNotifications": true,
    "passive": false,
    "debugLog": false
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `compactAfterTokensMode` | `"ratio"` | `"calibrated"` = fixed threshold, `"ratio"` = % of context window |
| `compactAfterTokensRatio` | `0.68` | Fraction of model's context window for ratio mode |
| `observeAfterTokens` | `10000` | Tokens between observation runs |
| `reflectAfterTokens` | `20000` | Tokens between reflection runs |
| `passive` | `false` | Suppress worker notifications (also via `PI_MEMORY_PASSIVE=1`) |

### Ratio mode behavior

| Model context | Compaction triggers at |
|---|---|
| 128K | ~87K tokens |
| 200K | ~136K tokens |
| 1M | ~680K tokens |

## Pipeline

```
Conversation entries
    │
    ▼
Observer agent ── extracts facts as observations (12-char hex IDs)
    │
    ▼
Reflector agent ── merges observations, tracks state changes
    │
    ▼
Dropper agent ── evicts low-value observations (never drops referenced ones)
    │
    ▼
Compaction hook ── produces om.folded for pi's compaction
```

## Error Handling

- **Observer**: Rejects invented source IDs, deduplicates identical content
- **Reflector**: Only references real observation IDs, preserves user assertions verbatim
- **Dropper**: Never drops observations still referenced by live reflections
- **Consolidation**: Each stage isolated — failure in one doesn't block others
- **Config**: Invalid values silently fall back to defaults

## Limitations

- Observer/reflector/dropper use separate `createAgentSession` calls — each is an LLM round-trip
- Pool size limited to `observationsPoolMaxTokens`
- V2→V3 migration handled once at startup
- `/om:view` UI untested (P3 gap)
