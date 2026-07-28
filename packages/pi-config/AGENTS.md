# Agent Rules

Rules for all contributors. Enforced, not aspirational.

## Naming conventions

- Extension files: kebab-case (`safety-gate.ts`, `get-diagnostics.ts`)
- Skills: kebab-case directory matching `name` in frontmatter
- Agent .md files: kebab-case matching `name` in frontmatter
- Commands: kebab-case, never shadow built-in pi commands
- Tools: snake_case, verb-object shape (`extract_questions`, `find_session`)
- On-disk JSON keys: snake_case (`audit_id`, `phase_id`)
- In-memory keys: camelCase
- Stable identifiers (mode names, phase IDs) are never renamed once shipped

## Interface contracts

Each extension in a package follows these contracts:

1. **Configuration** — read own JSON from `~/.pi/agent/<package>/<extension>.json`.
   Versioned (`version: 1`). Read at `session_start`, not at module load.
2. **Status** — single string via `ctx.ui.setStatus(key, text)`. Key = extension
   name. Don't write to other extensions' status keys.
3. **Widget** — transient UI via `ctx.ui.setWidget(key, content)`. Clear on
   `session_shutdown`.
4. **Persistence** — use `pi.appendEntry()` with `<extension>-state` customType.
   Restore on `session_start`. Never write to `getAgentDir()` root.
5. **State writes** — use `withFileMutationQueue` + temp-file + atomic rename.
   Corrupt files move to `.corrupt-<timestamp>`, never overwrite.

## Cross-package coordination

Allowed coordination mechanisms:

- `before_agent_start` chaining — each extension returns `{ systemPrompt }`,
  pi chains them. No package needs to know what else is installed.
- `pi.events` ad-hoc pub/sub — `emit(channel, data)` / `on(channel, handler)`.
  Generic, no typed schema, no priorities.
- `pi.getCommands()` and `pi.getAllTools()` — discover what other packages
  contributed. Use for awareness, not coupling.
- `settings.json` — read `defaultProvider`, `defaultModel`,
  `defaultThinkingLevel`, `theme`. Don't write to settings.

No shared `lib/` directory. No `import` from another package's source.
If two packages need shared code, publish a third package.

## Data directory rules

- Each extension writes to `~/.pi/agent/<package>/` directly.
- No `data/` subdirectory. The extension's package directory *is* its data
  directory.
- Document write locations in JSDoc at the top of each extension module.
- Document the full on-disk JSON schema in JSDoc.
- Don't write to `~/.pi/agent/` root — only to your package subdirectory.

## Anti-patterns

Don't do these. They are bugs, not style choices:

| Anti-pattern | Why | Do instead |
|---|---|---|
| Central brain `index.ts` | Couples everything | Registry-only entry point |
| Cross-package `shared/` | Hidden coupling | Publish a package |
| Typed event-bus contract | Breaks ad-hoc pub/sub | Use `pi.events` generically |
| Per-package `data/` subdirectory | Non-standard nesting | Write to `~/.pi/agent/<package>/` |
| Mode = flow state machine | Overengineered | Use prompt templates |
| `console.log` in extensions | Pollutes stdout | `ctx.ui.notify` or `console.error` |
| `shell: true` in exec | Injection risk | `execFileSync` with explicit args |
| Mocks in tests | Hides real failures | Real filesystem, always |
| Agent verifies own work | Confirmation bias | Separate agent, different model |
