# SPEC: pi-toolkit-tilldone

**Source:** `libs/pi-agent-toolkit/dotfiles/extensions/tilldone.ts` (524 lines)
**Package kind:** installable, no npm publish

## What it does

Off by default. `/tasks on` enables strict task discipline: agent must call `tilldone add` to define tasks before using other tools, must set one to `in_progress` before running anything, and can only mark `done` if a gate (e.g., a test command) passes. Persistent widget shows current task below the editor. Status line shows progress. Auto-nudge when agent finishes with incomplete tasks.

## State model: JSON + atomic write

```
~/.pi/agent/pi-toolkit/tilldone/<sessionId>/state.json
{
  "enabled": true,
  "tasks": [{ "id": 1, "text": "Implement X", "status": "inprogress" }],
  "nextId": 2
}
```

Uses `withFileMutationQueue` + temp file + `renameSync` + corruption-move. Read on every `before_agent_start`. Written on every state change.

## File split

```
packages/pi-toolkit/tilldone/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── SPEC.md
├── src/
│   ├── types.ts          # TaskStatus, Task, TillDoneState
│   ├── schemas.ts        # TypeBox for tool params + state
│   ├── state.ts          # readState, writeStateAtomic, withFileMutationQueue
│   ├── gates.ts          # isTaskGateSatisfied, beforeAgentStart enforcement
│   ├── widget.ts         # render widget, setStatus updates
│   ├── tool.ts           # tilldone add/done/next/prev/list/clear tool registration
│   ├── command.ts        # /tasks on/off/status handler
│   └── index.ts          # factory, wires tool+command+events
└── test/
    ├── state.test.ts
    ├── gates.test.ts
    ├── widget.test.ts
    ├── tool.test.ts
    ├── command.test.ts
    └── index.test.ts
```

## Source deltas

- **JSON state, not appendEntry**: tilldone reads state on every turn. JSON + atomic-write. Session-scoped.
- **Tool `action` enum**: uses `StringEnum` from `@earendil-works/pi-ai` for TypeBox.
- **Gate enforcement**: runs gate as a command; exit 0 = pass, else fail.
- **Auto-nudge on incomplete tasks**: soft notify, not a hard block.
- **TUI widget**: `ctx.ui.setWidget` + `ctx.ui.setStatus`.
