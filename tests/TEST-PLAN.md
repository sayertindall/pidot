# Test Plan

Assessed 2025-07-10. All line counts exclude `node_modules`.

---

## Scoring Rubric

| Factor | Weight |
|---|---|
| Test-to-source line ratio | 30% |
| Module coverage (% of source modules with tests) | 25% |
| Mock/pi API coverage (tests extension behavior vs just pure functions) | 20% |
| Error/edge case coverage | 15% |
| Test script wired up & runnable | 10% |

---

## Overall: **52% (F)**

Weighted by source lines across 6 packages.

| Package | Source Lines | Test Lines | Files | Tests | Grade | Weight |
|---|---|---|---|---|---|---|
| pi-process | 7,423 | 1,862 | 37 | 13 | **22% (F)** | 30% |
| pi-toolkit | 4,682 | 5,270 | 49 | 27 | **78% (B+)** | 18% |
| pi-memory | 3,991 | 3,647 | 31 | 21 | **85% (A)** | 16% |
| pi-config | 4,127 | 1,082 | 50 | 13 | **40% (D)** | 16% |
| pi-subagents | 3,157 | 545 | 12 | 5 | **30% (D-)** | 12% |
| pi-runtime | 1,982 | 2,230 | 27 | 16 | **68% (C+)** | 8% |

---

## Per-Package Breakdown

---

### pi-memory — **85% (A)**

**Status:** Best-in-class. Gold standard for how all packages should test.

| Metric | Value |
|---|---|
| Source | 31 files / 3,991 lines |
| Tests | 21 files / 3,647 lines |
| Ratio | 0.91:1 |
| Module coverage | ~90% |
| Test script | ✅ `"test": "vitest run"` |

**Strengths:**

- Mocks `createAgentSession`, `DefaultResourceLoader`, `SessionManager` from `@earendil-works/pi-coding-agent`
- Sub-agent tests capture invocation options and run tool `execute()` inline — no LLM needed
- Tests event handlers directly with synthetic events; asserts `pi.appendEntry`, `ctx.ui.notify` calls
- Strong edge cases: rejected source IDs, dedup, undefined returns, missing models, corrupt state, V2/V3 migration, empty pools

**Gaps:**

- `/om:view` UI renderers untested
- `index.ts` registration glue untested (thin at ~35 lines, low priority)
- Some internal plumbing in observer/dropper agent invocation

**Action items:**

- [ ] Low priority: UI renderer tests for `/om:view` (2-3 test files)
- [ ] Low priority: `index.ts` registration smoke test

---

### pi-toolkit — **78% (B+)**

**Status:** Strong. More test lines than source lines. Sub-packages are consistent.

| Metric | Value |
|---|---|
| Source | 49 files / 4,682 lines |
| Tests | 27 files / 5,270 lines |
| Ratio | 1.13:1 |
| Module coverage | ~85% |
| Test scripts | ✅ All 6 sub-packages wired |

**Sub-package status:**

| Sub-package | Test script | Notes |
|---|---|---|
| tilldone | ✅ | 73 tests, strong edge cases |
| loop | ✅ | 42 tests |
| coach | ✅ | 63 tests |
| clean-sessions | ✅ | 43 tests |
| find-session | ✅ | 46 tests, rg-based |
| qna | ✅ | 44 tests, extraction logic |

**Gaps:**

- `render.ts` (clean-sessions, coach) — UI rendering untested across multiple packages
- `selector.ts` (coach) — selection logic untested
- `schemas.ts` (find-session, qna) — TypeBox schemas untested
- Extension `index.ts` entry points not directly tested

**Action items:**

- [ ] Medium priority: `selector.ts` tests for coach (selection is decision logic)
- [ ] Low priority: `render.ts` UI tests across packages
- [ ] Low priority: Schema validation tests

---

### pi-runtime — **68% (C+)**

**Status:** Decent density where tests exist. Wiring gaps hold it back.

| Metric | Value |
|---|---|
| Source | 27 files / 1,982 lines |
| Tests | 16 files / 2,230 lines |
| Ratio | 1.13:1 |
| Module coverage | ~65% |
| Test scripts | ⚠️ 3 of 4 sub-packages wired |

**Sub-package status:**

| Sub-package | Test script | Tests | Notes |
|---|---|---|---|
| goal | ✅ | 79 | Strong: mocks ExtensionAPI, SessionManager, event handlers |
| worktree | ✅ | 24 | Good: mocks git commands and pi API |
| quit-and-delete | ✅ | 4 | Thin but real |
| notrace | ❌ | 25 | **Tests exist but no `"test"` script in package.json** |

**Gaps:**

- `notrace` can't be run via `pnpm -r test` — missing test script
- `types.ts` files (quit-and-delete, worktree) untested
- `extensions/index.ts` root entry untested
- notrace has 2 untested internal modules

**Action items:**

- [ ] **P0:** Add `"test": "vitest run"` to `pi-runtime/notrace/package.json`
- [ ] Low priority: Notrace internal module tests

---

### pi-config — **40% (D)**

**Status:** Tests exist but don't test extension behavior. No test script.

| Metric | Value |
|---|---|
| Source | 50 files / 4,127 lines |
| Tests | 13 files / 1,082 lines |
| Ratio | 0.26:1 |
| Module coverage | ~55% |
| Test script | ❌ Missing |

**Strengths:**

- Pure-function tests for validation, state transforms, IO are correct as far as they go
- 114 tests pass

**Gaps (critical):**

- **No pi API mocking.** Zero `vi.mock("@earendil-works/pi-coding-agent")` anywhere. Tests don't verify commands register, tools work, or event handlers fire.
- `review/selectors.ts` — complex selector logic, completely untested
- `review/targets.ts` — target resolution, completely untested
- `_shared/widget.ts` — widget base, untested
- All 7 extension `index.ts` entry points untested
- Enhance extension: runtime.ts, state.ts have tests but no integration with pi API

**Action items:**

- [ ] **P0:** Add `"test": "vitest run"` to `pi-config/package.json`
- [ ] **P1:** Add pi API mocks. Follow pi-memory pattern: `vi.mock("@earendil-works/pi-coding-agent")` with `createAgentSession`, `SessionManager`, `DefaultResourceLoader`
- [ ] **P1:** Test `review/selectors.ts` — the most complex untested logic in pi-config
- [ ] **P2:** Test `review/targets.ts`
- [ ] **P2:** Test extension index.ts registration (commands, tools, events)
- [ ] Low priority: `_shared/widget.ts`

---

### pi-subagents — **30% (D-)**

**Status:** The core spawn path is untested. Critical gap for a package that launches child agents.

| Metric | Value |
|---|---|
| Source | 12 files / 3,157 lines |
| Tests | 5 files / 545 lines |
| Ratio | 0.17:1 |
| Module coverage | ~45% |
| Test script | ✅ `"test": "vitest run"` |

**Strengths:**

- `discovery.test.ts` — creates real temp dirs, writes agent files, tests parsing
- `state.test.ts` — CRUD operations
- `schedule.test.ts` — timeout/abort logic

**Gaps (critical):**

- **`session-runner.ts` (741 lines)** — the core subagent spawner. Calls `createAgentSession`. Zero tests. This is the heart of the package.
- `harness-pi-rpc.ts` — process spawning, untested
- `runtime.ts` — untested
- `index.ts` — untested

**Action items:**

- [ ] **P0:** Test `session-runner.ts` — mock `createAgentSession`, test spawn options, model resolution, timeout, error handling
- [ ] **P1:** Test `harness-pi-rpc.ts` — mock child_process spawn, test RPC handshake
- [ ] **P2:** Test `runtime.ts` lifecycle

---

### pi-process — **22% (F)**

**Status:** The largest package. pi-dispatch drags it down to F.

| Metric | Value |
|---|---|
| Source | 37 files / 7,423 lines |
| Tests | 13 files / 1,862 lines |
| Ratio | 0.25:1 |
| Module coverage | ~30% |

**Sub-package status:**

| Sub-package | Test script | Tests | Grade | Notes |
|---|---|---|---|---|
| pi-dispatch | ✅ | 2 | **0%** | **5,264 lines, ZERO real tests. Two `expect(true).toBe(true)` stubs.** |
| pi-ssh | ❌ | ~15 | **81%** | Good tests for profiles, path-utils, remote-ops. No test script. |
| pi-tmux | ❌ | ~10 | **70%** | Decent tests for index, pane-ops. No test script. |
| pi-herdr | ✅ | 1 | Thin | Real but minimal |
| _shared | ❌ | 4 | Thin | 1-2 expects each. No test script. |

**pi-dispatch gap (the elephant):**

5,264 lines across 20 files. The PTY shell engine that powers `interactive_shell`.

| File | Lines | Tests | Priority |
|---|---|---|---|
| `commands.ts` | 824 | None | P0 — command parser/executor |
| `runtime.ts` | 676 | None | P0 — state machine lifecycle |
| `supervision.ts` | 441 | None | P1 — process supervision modes |
| `spawn.ts` | 335 | None | P1 — PTY spawn (mock node-pty) |
| `overlay.ts` | 288 | None | P2 — UI overlay rendering |
| `config.ts` | 289 | None | P2 — config validation |
| `frame-parser.ts` | ~200 | None | P1 — PTY frame parsing (pure function) |
| Others | ~1,200 | None | P2 |

**Mock boundary for pi-dispatch:** Not pi's SDK — it's `node-pty`. The PTY spawn is the thing to mock. Frame parsing and state machine logic are testable as pure functions.

**Action items:**

- [ ] **P0:** Add `"test": "vitest run"` to `pi-ssh/package.json` and `pi-tmux/package.json`
- [ ] **P0:** `pi-dispatch/commands.ts` — command parser tests (pure function, no mocks needed)
- [ ] **P0:** `pi-dispatch/runtime.ts` — state machine tests (mock node-pty, test transitions)
- [ ] **P1:** `pi-dispatch/frame-parser.ts` — frame parsing tests (pure function, no mocks)
- [ ] **P1:** `pi-dispatch/spawn.ts` — mock node-pty, test spawn options and lifecycle
- [ ] **P1:** `pi-dispatch/supervision.ts` — supervision mode tests
- [ ] **P2:** `_shared` — beef up safe-exec, confirmation tests

---

## Immediate Fixes (0 effort, high impact)

These are package.json edits, not new tests.

| Package | File | Fix |
|---|---|---|
| pi-config | `packages/pi-config/package.json` | Add `"test": "vitest run"` to scripts |
| pi-ssh | `packages/pi-process/pi-ssh/package.json` | Add `"test": "vitest run"` to scripts |
| pi-tmux | `packages/pi-process/pi-tmux/package.json` | Add `"test": "vitest run"` to scripts |
| notrace | `packages/pi-runtime/notrace/package.json` | Add `"test": "vitest run"` to scripts |
| _shared | `packages/pi-process/_shared/package.json` | Add `"test": "vitest run"` to scripts |

**Impact:** Unlocks ~55 existing tests that `pnpm -r test` currently skips.

---

## Priority Roadmap

### Phase 1 — Wire up (do first)

Mechanical package.json edits. No new code.

1. Add missing `"test"` scripts (5 packages above)
2. Verify `pnpm -r test` runs all tests end-to-end
3. Expected: 685+ tests passing, zero skips

### Phase 2 — Critical gaps

Target: move overall score from 52% to ~65%.

1. **pi-dispatch state machine + frame parser** (~400 new test lines)
   - Mock boundary: `node-pty` spawn
   - Test state transitions, frame parsing, command dispatch
2. **pi-subagents `session-runner.ts`** (~300 new test lines)
   - Mock boundary: `createAgentSession` (same pattern as pi-memory)
   - Test spawn options, model resolution, timeout, error handling
3. **pi-config review/selectors.ts + targets.ts** (~200 new test lines)
   - Pure function tests, no mocks needed

### Phase 3 — Pi API mocking

Target: move overall score from ~65% to ~75%.

1. **pi-config** — add `vi.mock("@earendil-works/pi-coding-agent")` and test extension registration
2. **pi-dispatch** — supervision.ts, spawn.ts with node-pty mocks
3. **pi-subagents** — harness-pi-rpc.ts, runtime.ts

### Phase 4 — Polish

Target: move overall score to 80%+.

1. UI renderer tests (render.ts across packages)
2. Schema validation tests
3. Extension index.ts smoke tests
4. _shared beef-up

---

## Testing Methodology

### Three tiers of testing

#### 1. Unit tests (no pi process) — primary approach

Mock `createAgentSession` / `SessionManager` from `@earendil-works/pi-coding-agent` and test extension logic in isolation.

Key patterns:
- Mock pi's SDK entry points — capture options, control behavior from tests
- Test the handler, not the framework — call event handlers directly with synthetic events
- Test sub-agents programmatically — set a `promptHandler` that calls tool `execute()` with synthetic LLM output

Setup: vitest + plain Node, `fileParallelism: false` for stateful tests.

#### 2. Interactive smoke tests with `pi -e`

```bash
pi -e ./extensions/my-ext/index.ts
```

Validates registration (tools appear, commands fire, events trigger). Not for CI.

#### 3. Programmatic end-to-end with `createAgentSession()`

For pre-release integration gating only. Needs API keys, slow, expensive.

### Recommended stack

| Concern | Tool |
|---|---|
| Test runner | vitest |
| Linting | biome |
| Types | tsc --noEmit |
| Peer deps | `@earendil-works/pi-*` as peerDependencies (optional) |
| Dev deps | Pin `@earendil-works/pi-*` versions for type checking in tests |

**Key principle:** Test the logic in your extensions, not pi's framework. Mock the boundary at `createAgentSession` / `SessionManager`. Only reach for live-pi testing when you need to verify registration glue or UI components.
