# Spec: pi-toolkit-loop

**Source:** `libs/pi-agent-toolkit/dotfiles/extensions/loop.ts` (445 lines)
**Target:** `packages/pi-toolkit/loop/`
**Package kind:** installable, no npm publish

## What it does

`/loop tests` (or `self`, or `custom <condition>`) — the agent keeps going on a follow-up loop until breakout. At each `agent_end`, the extension sends the same prompt again. Loop ends when the agent calls `signal_loop_success`. State lives in the session log so it survives compaction. Widget shows "Loop active: tests pass (turn 12)". On model abort, asks "break the loop?".

## File split

```
packages/pi-toolkit/loop/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── SPEC.md
├── src/
│   ├── types.ts          # LoopMode, LoopStateData, LoopPreset
│   ├── presets.ts        # LOOP_PRESETS, buildPrompt, summarizeCondition
│   ├── selector.ts       # showLoopSelector (TUI preset picker)
│   ├── state.ts          # loadState, persistState (appendEntry wrapper)
│   ├── summarizer.ts     # summarizeBreakoutCondition (LLM call)
│   └── index.ts          # factory (≤150 LOC)
└── test/
    ├── presets.test.ts
    ├── state.test.ts
    ├── summarizer.test.ts
    └── index.test.ts
```

## Function contracts

### `src/types.ts`

```typescript
export type LoopMode = "tests" | "custom" | "self";

export interface LoopStateData {
  active: boolean;
  mode?: LoopMode;
  condition?: string;
  prompt?: string;
  summary?: string;
  loopCount?: number;
}

export interface LoopPreset {
  value: LoopMode;
  label: string;
  description: string;
}
```

### `src/presets.ts`

```typescript
export const LOOP_PRESETS: readonly LoopPreset[];
export const LOOP_STATE_ENTRY = "loop-state";

export function buildPrompt(mode: LoopMode, condition?: string): string;
export function summarizeCondition(mode: LoopMode, condition?: string): string;
export function getConditionText(mode: LoopMode, condition?: string): string;
```

### `src/state.ts`

Uses `appendEntry` for canonical state (appendEntry is the default; state is read on `agent_end`, once per turn end).

```typescript
export async function loadState(ctx: ExtensionContext): Promise<LoopStateData>;
export function persistState(pi: ExtensionAPI, state: LoopStateData): void;
```

### `src/summarizer.ts`

Tries haiku first (if anthropic is the provider), then the current model. Returns a short summary (max 6 words, max 60 chars), or the fallback from `summarizeCondition()` on any error.

```typescript
export async function summarizeBreakoutCondition(
  ctx: ExtensionContext,
  mode: LoopMode,
  condition?: string,
): Promise<string>;

export async function selectSummaryModel(
  ctx: ExtensionContext,
): Promise<{ model: Model<any>; apiKey: string; headers?: Record<string, string> } | null>;
```

### `src/index.ts`

The factory. Registers:
- `pi.registerTool({ name: "signal_loop_success", ... })`
- `pi.registerCommand("loop", ...)`
- `pi.on("agent_end", ...)`
- `pi.on("session_before_compact", ...)`
- `pi.on("session_start", ...)`
