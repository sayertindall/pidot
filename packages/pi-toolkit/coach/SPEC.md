# Spec: pi-toolkit-coach

**Source:** `libs/pi-agent-toolkit/dotfiles/extensions/coach.ts` (696 lines)
**Target:** `packages/pi-toolkit/coach/`
**Package kind:** installable, no npm publish

## What it does

`/coach` or `/coach last` -- LLM-powered meta-analysis of how you use Pi. Reads actual session content (user messages, tool calls, file paths, session structure), sends the collected evidence to the active model with a coaching prompt, and gets back a markdown report: "You keep interrupting the agent mid-tool -- try waiting 5s. You missed an opportunity to use the `find-session` tool here. Consider building a `commit-msg-gen` skill." Slow and expensive by design.

## File split (696 LOC, full concern split)

```
packages/pi-toolkit/coach/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── SPEC.md
├── src/
│   ├── types.ts          # CoachScope, SessionDigest, CoachingReport
│   ├── scope.ts          # resolveScope, findSessions
│   ├── extract.ts        # sessionDigest: walk JSONL, extract user/assistant/tool content
│   ├── summarize.ts      # messageContentToText, MAX_MSG_CHARS, MAX_ASSISTANT_CHARS
│   ├── prompt.ts         # buildCoachingPrompt, system prompt
│   ├── render.ts         # formatCoachingReport (markdown table-of-contents, etc.)
│   ├── selector.ts       # TUI scope picker (current vs all)
│   ├── command.ts        # /coach, /coach last handlers
│   └── index.ts          # factory (<=80 LOC)
└── test/
    ├── extract.test.ts
    ├── summarize.test.ts
    ├── prompt.test.ts
    ├── render.test.ts
    └── command.test.ts
```

## Function contracts

### `src/types.ts`

```typescript
export type CoachScope = "current" | "all";

export interface SessionDigest {
  sessionId: string;
  sessionFile: string;
  startedAt: number;
  userMessages: Array<{ ts: number; text: string }>;
  assistantTurns: number;
  toolCalls: Array<{ name: string; args: string; ts: number; result: "ok" | "error" }>;
  filesTouched: string[];
  durationMs: number;
}

export interface CoachingReport {
  scope: CoachScope;
  sessionsAnalyzed: number;
  markdown: string;  // the LLM's output
  generatedAt: number;
  model: string;
}
```

### `src/scope.ts`

```typescript
export function findSessions(scope: CoachScope, currentCwd: string): string[];
export function findLastSession(): string | null;
```

`findSessions("all")`: walks `~/.pi/agent/sessions/` recursively, returns all `.jsonl` paths.
`findSessions("current")`: returns `~/.pi/agent/sessions/<cwd-hash>/` if exists, else empty.
`findLastSession()`: returns the most recently modified `.jsonl` in `~/.pi/agent/sessions/`.

### `src/extract.ts`

```typescript
const MAX_SESSIONS_DETAILED = 15;

export async function sessionDigest(sessionFile: string): Promise<SessionDigest>;
```

Streams the JSONL with `readline.createInterface`, extracts:
- User messages (with `text` content, truncated to MAX_MSG_CHARS).
- Assistant turns (count only).
- Tool calls (name, args preview, timestamp, ok/error).
- Files touched (anything that looks like a file path in tool args).

### `src/summarize.ts`

```typescript
const MAX_MSG_CHARS = 500;
const MAX_ASSISTANT_CHARS = 200;

export function messageContentToText(content: unknown): string;
export function truncate(s: string, max: number): string;
```

`messageContentToText`: flattens an LLM message content (string or array of parts) to plain text.

### `src/prompt.ts`

The coaching system prompt. Lays out the structure of the expected output (categories like "Tool usage", "Missed opportunities", "Workflow improvements", "Skill suggestions"). ~50 lines of system prompt text, but the spec is the actual content.

### `src/render.ts`

```typescript
export function formatCoachingReport(
  report: CoachingReport,
  digests: SessionDigest[],
): string;
```

Returns the final markdown the user sees. Includes a header with scope, sessions analyzed, model; then the LLM's report body; then a footer with the file paths the analysis was based on.

### `src/selector.ts`

A TUI picker: `current` vs `all` (only if there are sessions in both scopes). Defaults to the selection the user made last time (persisted via appendEntry).

### `src/command.ts`

`/coach` or `/coach` with no args:
- If `!ctx.hasUI` -> notify and exit.
- If `!ctx.model` -> notify and exit.
- Show the scope selector.
- Find sessions, build digests (cap at MAX_SESSIONS_DETAILED for the prompt; mention how many were omitted).
- Run the LLM with the coaching prompt.
- Display the report.

`/coach last`:
- Skip the scope selector.
- Just analyze the most recent session.

### `src/index.ts`

Wires the command. ~80 LOC.

## Tests

- `extract.test.ts`: synthetic JSONL, drive `sessionDigest`, assert user messages, tool calls, files touched.
- `summarize.test.ts`: `messageContentToText` for string, array, mixed.
- `prompt.test.ts`: the system prompt is a string, just assert it's non-empty and contains the expected categories.
- `render.test.ts`: format a report, assert the markdown has the expected sections.
- `command.test.ts`: fake ctx with modelRegistry. Drive `/coach` and `/coach last`. Mock the LLM. Assert the report is rendered.

## Source deltas

- **Slow and expensive by design**: source has a BorderedLoader during the LLM call. Keep.
- **`MAX_SESSIONS_DETAILED = 15`**: the cap on sessions to analyze in one prompt. Keep.
- **Truncation**: source truncates user messages to 500 chars and assistant to 200 chars. Keep. The `truncate` helper is shared.
- **No JSON state**: appendEntry for the last-scope-selection preference. The actual coaching reports are returned to the caller; not persisted.
