# `find-session` — port spec

**Target:** `packages/pi-toolkit/find-session/`
**Source:** `libs/pi-agent-toolkit/dotfiles/extensions/find-session.ts` (1527 lines) — **source is over-engineered; do not port it 1:1.** This spec is a rewrite down to the simple version the user asked for.
**Layout:** per `ask_user` answer — each package is its own installable, no npm publish for pi-toolkit.

## What it does (plain English)

You remember working on something last week but you don't remember which session. Run `/find-session auth rate limiter`. The extension uses `fd` to list session JSONLs, then `rg` to find which sessions contain the query, then opens a TUI scrollable list of matches (file + matched line). You press up/down to pick, Enter to resume into that session. Esc cancels.

That's it. No phases, no choose-scope, no LLM re-ranking, no heuristic scoring, no refine-loop. `fd` and `rg` do the work; the TUI is a list.

## How it works (mechanics)

1. **Build the search query** from `args`: strip whitespace, fall back to a notification "Usage: /find-session <query>" if empty.
2. **Run `rg`** across `~/.pi/agent/sessions/`. Use `--json` to get structured `{"type":"match","data":{...}}` lines. With `--json`:
   - `rg -i -F --json --max-columns=200 -g '*.jsonl' "<query>" <sessions-dir>`
   - `-i` case-insensitive, `-F` literal text (no regex metacharacter footguns from user input), `--max-columns=200` trims wide lines, `-g '*.jsonl'` restricts to session files.
3. **Group matches by file.** Each file gets one entry in the result list, with the first matched line as a preview. Cap at top 50 files.
4. **Render TUI** with the list. Up/Down to move, Enter to resume, Esc to cancel.
5. **On Enter:** `ctx.waitForIdle()`, then `ctx.switchSession(selectedPath)`. Notify on cancellation.

**`fd` is not actually needed** — `rg -g '*.jsonl'` does the file discovery + content search in one pass. The user's instruction to "use fd & rg" was directionally right (use the tools, don't reinvent), but the cleanest realization is rg-only with `-g` glob. If `rg` is missing, fall back to `fs.readdir` recursive + per-file `readFile` + `String.prototype.includes`.

## Source structure (1527 lines, monorepo today) — **mostly thrown out**

The source does much more than this spec:
- Multi-phase TUI (`choose-scope` then `search`)
- Heuristic shortlisting + LLM re-ranking
- JSONL parsing to extract first/last user messages
- Display formatting (project labels, home-relative paths, line-fitting)
- Custom Input component for query refinement

We don't port any of that. The 1527 lines collapse to ~400 LOC across 5 src files.

## Target layout (concern-split, ≤200 LOC per file)

```
packages/pi-toolkit/find-session/
├── package.json                 # name: pi-toolkit-find-session, pi.extensions: ["./src/index.ts"]
├── tsconfig.json                # strict, noUncheckedIndexedAccess, verbatimModuleSyntax,
│                                  allowImportingTsExtensions, noEmit
├── vitest.config.ts             # fileParallelism: false, PI_CODING_AGENT_DIR override
├── README.md                    # short — Quick Start, /find-session command, fd/rg requirements
├── LICENSE                      # MIT
├── SPEC.md                      # this file
├── src/
│   ├── types.ts                 # SessionMatch, FindSessionSelection, RGJsonLine. ~30 LOC.
│   ├── search.ts                # rg exec + fs fallback, group by file. ~100 LOC.
│   ├── component.ts             # scrollable TUI list. ~150 LOC.
│   ├── index.ts                 # factory, ~50 LOC (wiring only).
│   └── schemas.ts               # TypeBox stub for the future find-session tool. ~30 LOC.
└── test/
    ├── search.test.ts           # fake `pi.exec`, fake `rg` output, fs fallback tests. ~150 LOC.
    ├── component.test.ts        # render snapshots for empty / one-match / many-matches. ~80 LOC.
    └── index.test.ts            # integration: register command, drive handler, assert switchSession. ~80 LOC.
```

Total: 5 src files (~360 LOC), 3 test files (~310 LOC). The original 1527 collapses to ~670.

## Per-module contracts

### `types.ts` (pure types)

```typescript
/** A single rg --json match line, after parsing. */
export interface RgMatchLine {
  filePath: string;          // absolute
  lineNumber: number;
  matchedText: string;       // the matched line, trimmed to MAX_PREVIEW
  projectLabel: string;      // basename of parent dir, or repo name
}

/** A session grouped by file, with the first match as preview. */
export interface SessionMatch {
  filePath: string;
  projectLabel: string;
  firstMatch: RgMatchLine;
  matchCount: number;        // total matches in this file
}

export interface FindSessionSelection {
  filePath: string;
}
```

No functions, no runtime.

### `search.ts` (the only I/O module)

```typescript
const RG_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 50;
const MAX_PREVIEW = 200;
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

/** Run rg --json across ~/.pi/agent/sessions/, group matches by file, return top N. */
export async function searchSessions(
  pi: ExtensionAPI,
  query: string,
  signal?: AbortSignal,
): Promise<SessionMatch[]>;

/** Parse one line of `rg --json` output. Returns null for non-match events. */
export function parseRgJsonLine(line: string): RgMatchLine | null;

/** Group RgMatchLines by filePath, keep first match as preview, sort by match count desc. */
export function groupByFile(matches: RgMatchLine[]): SessionMatch[];

/** Fallback when rg is missing: walk sessions dir, read each JSONL, substring-match. */
export async function searchSessionsFallback(
  pi: ExtensionAPI,
  query: string,
  signal?: AbortSignal,
): Promise<SessionMatch[]>;
```

`searchSessions` calls `pi.exec("rg", args, { signal, timeout: RG_TIMEOUT_MS })` with the args:
```
["-i", "-F", "--json", "--max-columns=200", "-g", "*.jsonl", query, SESSIONS_DIR]
```

On `result.killed` (timeout) → throw. On `result.code === 1` with no output (rg "no matches") → return `[]`. On `result.code !== 0` and not 1 → fall back to `searchSessionsFallback`. On `result.code === 0` → parse each stdout line, group, return top 50.

`searchSessionsFallback` uses `fs.readdir` recursive + `fs.readFile` per file + `text.includes(query.toLowerCase())`. Same cap (50), same preview logic.

The fd-only path is **not used.** The spec uses rg's `-g '*.jsonl'` glob for both file discovery and content search. Documented in the README: "If you prefer fd-then-rg, fork the extension; the rest of the package doesn't care."

### `component.ts` (TUI)

```typescript
export class FindSessionComponent implements Component, Focusable {
  constructor(options: FindSessionComponentOptions);
  setMatches(matches: SessionMatch[]): void;  // called after search completes
  setError(message: string | null): void;
  // Component interface
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
  // Focusable interface
  focus(): void;
  blur(): void;
}
```

Internal state: `matches`, `selectedIndex`, `error`, `loading`. ~150 LOC including render logic.

Render: scrollable list, one line per match: `▸ <projectLabel>  <file basename>:<line>  <preview>`. Selected row highlighted. Status bar: `<N> matches · ↑↓ to move · Enter to resume · Esc to cancel`.

Input: Up/Down move selection (clamped). PageUp/PageDown jump 10. Enter calls `onDone({ filePath: matches[selectedIndex].filePath })`. Esc calls `onDone(null)`.

This is small enough to NOT be the 450-LOC file from the original spec. Single class, three render branches (empty / one-or-more / error), no phase state.

### `index.ts` (wiring only)

```typescript
export default function findSessionExtension(pi: ExtensionAPI): void {
  pi.registerCommand("find-session", {
    description: "Search saved Pi sessions with ripgrep and resume a match",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/find-session requires interactive mode", "error");
        return;
      }
      const query = (args ?? "").trim();
      if (!query) {
        ctx.ui.notify("Usage: /find-session <query>", "info");
        return;
      }
      const selection = await ctx.ui.custom<FindSessionSelection | null>((tui, theme, _kb, done) => {
        const component = new FindSessionComponent({ tui, theme, onDone: done });
        component.setMatches([]);  // show "searching..." while we run
        // Kick off the search without blocking the TUI mount.
        void (async () => {
          try {
            const matches = await searchSessions(pi, query);
            component.setMatches(matches);
          } catch (err) {
            component.setError(err instanceof Error ? err.message : String(err));
          }
        })();
        return component;
      });
      if (!selection) return;
      try {
        await fs.access(selection.filePath);
      } catch {
        ctx.ui.notify(`Session file no longer exists: ${selection.filePath}`, "error");
        return;
      }
      await ctx.waitForIdle();
      const result = await ctx.switchSession(selection.filePath);
      if (result.cancelled) ctx.ui.notify("Session switch cancelled", "info");
    },
  });
}
```

~50 LOC including imports. No business logic. The async-search-inside-TUI pattern lets the TUI mount immediately showing "searching…" while rg runs in the background; the component updates via `setMatches` when done.

### `schemas.ts` (TypeBox stub for future tool)

The source registers only a command. A tool (`find_session` invoked by the agent) is a natural extension. Stub the schema so we don't break the import boundary later:

```typescript
import { Type } from "typebox";

export const FindSessionToolParams = Type.Object({
  query: Type.String({ description: "Literal text to search for across past Pi sessions" }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
});
```

Unused by the current extension. Documented as forward-compatible.

## Test strategy

Per the family convention (real fs, vitest, `fileParallelism: false`, `PI_CODING_AGENT_DIR` env override):

| Test file | Strategy | Fixtures |
|---|---|---|
| `search.test.ts` | Fake `pi.exec` returning canned `rg --json` output; assert `searchSessions` returns the right `SessionMatch[]`. Fake `pi.exec` to throw (rg missing); assert `searchSessionsFallback` is used and produces the right output. | Inline rg JSON lines + `mkdtempSync` session files |
| `component.test.ts` | Build the component with 0 / 1 / 50 matches; call `render(120)`; assert the output string equals a snapshot. Drive `handleInput` to test Up/Down/Enter/Esc. | Strings only |
| `index.test.ts` | Fake `pi` (same pattern as `pi-tmux/extensions/tmux/test/index.test.ts`); register the command; invoke the handler with a fake `ctx`; assert `ctx.switchSession` was called with the right path. Test the four error paths (no UI, empty query, file missing, switch cancelled). | Fake pi + fake ctx |

Coverage targets:
- `parseRgJsonLine`: match line, non-match event, malformed JSON, empty line.
- `groupByFile`: empty input, single match per file, multiple matches per file (first wins), sort order.
- `searchSessions`: rg success, rg exit 1 (no matches), rg timeout, rg exit 2 (error → fallback), rg missing.
- `searchSessionsFallback`: real fs with `mkdtempSync`, 3 fake session files (1 match, 2 matches, 0 matches), assert result order.
- `FindSessionComponent.render`: empty (no matches yet), one match, many matches (truncation), error state, loading state.
- `FindSessionComponent.handleInput`: Up/Down move selection, Enter onDone with selection, Esc onDone null, PageUp/PageDown jump.
- `index.ts`: happy path (query → matches → switch), no-UI error, empty-query usage hint, file-missing error, switch-cancelled notify.

## Rework deltas vs. the source

1. **Drop the multi-phase TUI.** The source's `choose-scope` and `search` phases collapse to a single TUI that shows the result list (or a "searching…" placeholder while rg runs).
2. **Drop LLM re-ranking.** Source uses `completeSimple` to re-rank candidates. The spec uses rg's match count + file order. No `modelRegistry` dependency in the test fakes.
3. **Drop JSONL parsing.** Source extracts first/last user messages from each session. The spec uses rg's matched line directly as the preview. No `node:readline`, no `parseSessionCandidate`.
4. **Drop heuristic scoring.** Source has `scoreCandidate`, `scoreSnippetMatch`, `buildHeuristicWhy`, etc. The spec uses rg's exit code 0 with the file order from stdout.
5. **Drop display formatting helpers.** Source has `toHomeRelative`, `getProjectLabel`, `getDisplayName`, `fitLine`, `joinReasons`. The spec has a single inline format string in `component.ts`.
6. **Single search backend, with one fallback.** Source walks files via `walkSessionFiles` then runs LLM ranking. The spec runs rg (which does both in one pass), with a `fs.readdir` + `readFile` fallback if rg is missing.
7. **Component class is small.** Source's `FindSessionComponent` is 444 LOC across 12 input handlers. The spec's component is ~150 LOC with 4 input handlers (Up, Down, PageUp/Down, Enter, Esc).
8. **No `pi.events`.** Source doesn't use it. The spec doesn't either.
9. **No `console.log`.** Source has none. Preserved.

The 1527 → ~670 LOC reduction is the headline. The source is a 1.5k-line TUI-driven LLM-ranking pipeline; the spec is a 670-line rg wrapper with a scrollable list.

## What this spec does NOT do (intentionally)

- **No LLM ranking.** rg's match order is the order. If users want re-ranking, they can layer it later.
- **No multi-phase TUI.** No "choose scope" (local vs all), no refine-loop. Single search, single result list.
- **No JSONL parsing.** rg returns matched lines; we don't extract first/last user messages from each session.
- **No session-name matching.** rg searches content. Session names (if present) are part of the file content for some formats but not a separate index.
- **No fd.** rg's `-g '*.jsonl'` does the file discovery. If a user wants fd-then-rg, that's a different extension.
- **No tool registration.** The source registers only a command. The spec stubs a tool schema but doesn't wire it; that's a separate task.
- **No fuzziness or stemming.** rg `-F` is literal text. `-i` is case-insensitive. No fuzzy match, no Levenshtein. If users want that, integrate `fzf` or `skim`.

## Step-by-step port plan

1. **Create the package skeleton** (`package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `LICENSE`).
2. **Write `types.ts`** — pure types, no logic. `tsc --noEmit` clean.
3. **Write `search.ts` + `test/search.test.ts`** — the only I/O module. Test with fake `pi.exec` (rg success, rg exit 1, rg exit 2 fallback path, rg missing fallback path, rg timeout) and `mkdtempSync` for the fs fallback.
4. **Write `component.ts` + `test/component.test.ts`** — small TUI component. Render snapshots for 0/1/N matches + error state. Drive `handleInput` for Up/Down/Enter/Esc.
5. **Write `schemas.ts`** — TypeBox stub.
6. **Write `index.ts` + `test/index.test.ts`** — wire it all together. Integration test with the fake pi pattern from `pi-tmux/extensions/tmux/test/index.test.ts`.
7. **Final pass:** `tsc --noEmit` clean, `vitest run` green, smoke test (`/find-session auth` in a fake session).

Estimated effort: 2-3 hours. The 1527 → 670 collapse is most of the work; the rest is mechanical port.

## Link map corrections (final, post term-notify removal)

| Package | Extensions | Source | LOC |
|---|---|---|---|
| **pi-toolkit** (7) | qna | `libs/pi-agent-toolkit/dotfiles/extensions/qna-interactive.ts` | 554 |
| | loop | `libs/pi-agent-toolkit/dotfiles/extensions/loop.ts` | 445 |
| | tilldone | `libs/pi-agent-toolkit/dotfiles/extensions/tilldone.ts` | 524 |
| | find-session | **rewrite (this spec)** | 670 |
| | clean-sessions | `libs/pi-agent-toolkit/dotfiles/extensions/clean-sessions.ts` | 522 |
| | coach | `libs/pi-agent-toolkit/dotfiles/extensions/coach.ts` | 696 |
| | handoff | `libs/pi-extensions/packages/pi-handoff/handoff.ts` | 234 |
| **pi-runtime** (4) | goal | `libs/pi-extensions/packages/pi-goal/index.ts` | 700+ |
| | worktree | `libs/pi-extensions/packages/pi-worktree/index.ts` | 380 |
| | notrace | `libs/nothing/packages/notrace/extensions/notrace/index.ts` | small + tests + templates |
| | quit-and-delete | `libs/pi-extensions/packages/pi-quit-and-delete/index.ts` | 65 |
| **pi-mcp** (1, npm'd) | mcp-adapter | **design from scratch** (no source — core MCP is in `libs/oh-my-pi/.../src/mcp/`) | TBD |
| **pi-memory** (1, vendored) | observational memory | `elpapi42/pi-observational-memory` v3.0.3 (already vendored) | 30 src / 22 tests |

12 ports (pi-toolkit 7 + pi-runtime 4 + pi-mcp 1) + 1 vendored integration (pi-memory). 11 have real sources. pi-mcp is the only from-scratch design.

## Open questions

- **License for the rewritten find-session:** MIT (matches the original source). Confirm before copying the header.
- **`fd` should we include it for real:** the spec uses rg-only. If you want fd-then-rg, I can swap in 30 LOC of fd-discovery before the rg pass. Currently the spec says rg-only.
- **Match-count cap at 50:** arbitrary. Could be 100, 200, configurable. Default to 50 unless you say otherwise.
- **First-match-as-preview vs all-matches:** spec shows only the first match per file. If you want a `(3 matches in this file)` indicator on the row, ~10 LOC of additional component work.
