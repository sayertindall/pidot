# pi-memory Refactor Issues

## Problem Statement

pi-memory was refactored by two agents (p18: de-vendor + strict TS, p19: agent refactor) operating on the same codebase in parallel. After their work, the code was committed but the test suite has 10 failures across 4 test files. The failures fall into three categories:

### Category 1: Test expectations stale after de-vendoring

The p18 agent renamed the package from `pi-observational-memory` to `pi-memory` and changed internal constants (config keys, env var names, default values). Tests still reference the old names and old defaults.

**Specific instances:**
- `config.test.ts`: Tests reference old config key `"observational-memory"` → now `"pi-memory"`
- `config.test.ts`: Tests reference old env var `PI_OBSERVATIONAL_MEMORY_*` → now `PI_MEMORY_*`
- `config.test.ts`: Tests expect old default values (`reflectAfterTokens: 20`, `compactAfterTokens: 30`) → actual defaults changed to (`20_000`, `81_000`) by p18. **Unknown if this change was intentional or accidental.**
- `config.test.ts`: New config fields `compactAfterTokensMode` and `compactAfterTokensRatio` were added by p18 but tests don't account for them.
- `debug-log.test.ts`: File paths reference old `observational-memory/` directory → now `pi-memory/`
- `runtime.test.ts`: Error message strings reference `"observational-memory"` → now `"pi-memory"`

**Root cause:** p18 changed production code but did not update tests. Unknown whether default value changes (20→20_000, 30→81_000) were intentional.

### Category 2: Tests broken by agent refactor (agentLoop → createAgentSession)

The p19 agent refactored observer/dropper/reflector agents from using the old `agentLoop` API (from `pi-agent-core`) to `createAgentSession` (from `pi-coding-agent`). Tests used `fakeAgentLoop` to simulate LLM responses. The new API requires mocking `createAgentSession` instead.

**Specific instances:**
- `observer.test.ts`, `dropper.test.ts`, `reflector.test.ts`: Tests pass `agentLoop` and `apiKey` in args → new interfaces use `modelRegistry` and `cwd`
- All 3 test files: `fakeAgentLoop` pattern no longer works with `createAgentSession`
- `consolidation-trigger.test.ts`: Mock for `resolveModel` was updated but `reason` field removed from mock data, breaking the model-failure test path

**Root cause:** p19 changed the agent interface but did not update tests. The `fakeAgentLoop` → `createAgentSession` mock pattern needs complete rewriting per test file.

### Category 3: New strict TypeScript flags surface pre-existing errors

The p18 agent enabled `strict: true`, `noUncheckedIndexedAccess: true`, and `noUnusedLocals: true` in tsconfig. This surfaced errors that were previously hidden.

**Specific instances:**
- `session-ledger-recall.test.ts`: 8 `Object is possibly 'undefined'` errors from array access after `noUncheckedIndexedAccess`
- `view-command.test.ts`: Tuple index access error
- `recall-tool.test.ts`: Implicit `any` on filter predicate, property access on untyped `{}`

**Root cause:** Pre-existing type errors in vendored upstream code. Not caused by the refactor, but surfaced by new strict flags.

## Approach Taken (and its problems)

The assistant attempted to fix all failures rapidly using `sed` commands to replace strings in test expectations. This is wrong because:

1. **Tests were changed to match code, rather than code verified against tests.** The tests are supposed to define correct behavior. If a test fails after a code change, the question should be "is the code change correct?" not "how do I make this test pass?"

2. **Default value changes were not investigated.** `reflectAfterTokens` changed from 20 to 20_000. Was this an intentional policy change, or an accidental edit during de-vendoring? The test expected 20 and the code now has 20_000. Without investigating WHY this changed, we can't know if the new value is correct.

3. **No verification that the agent refactor preserves existing behavior.** The observer/dropper/reflector agents were rewritten to use `createAgentSession`. Do they still:
   - Build the same system prompts?
   - Return the same output types?
   - Handle errors the same way?
   - Respect the same configuration?
   The tests would answer these questions, but they were rewritten to match the new behavior without verifying the new behavior is correct.

4. **Pre-existing type errors were excluded rather than fixed.** The `session-ledger-recall.test.ts` and `view-command.test.ts` files were excluded from tsconfig rather than fixing the actual type issues. This hides problems instead of fixing them.

## Current State

- 197/197 tests pass
- Typecheck passes (0 errors)
- But passing tests were achieved by rewriting assertions to match code, not by verifying code correctness

## Open Questions

1. Were the default value changes intentional? (`reflectAfterTokens: 20→20_000`, `compactAfterTokens: 30→81_000`, `observeAfterTokens: 100→10_000`)
2. Does the `createAgentSession` refactor correctly inherit modelRegistry, thinkingLevel, and use SessionManager.inMemory()?
3. Are the runtime header and transcript persistence correctly implemented?
4. Should excluded test files (session-ledger-recall, view-command) be fixed rather than excluded?
5. Does the de-vendoring cover ALL references? (env var names, config keys, error messages, file paths)

## Next Steps Needed

1. Audit every change p18 made to defaults/config — verify each is intentional
2. Read the refactored agent code and verify it calls `createAgentSession` correctly against GUIDE.md §3.13
3. Read the actual system prompts in the refactored agents and verify they preserve all guidance from the originals
4. Re-include the excluded test files and fix their type errors properly
5. Run the full test suite with the ORIGINAL test expectations (before sed replacements) to see what actually broke
