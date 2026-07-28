---
name: verify
description: "Prove work before claiming done. Trigger when finishing implementation, before marking a task complete, or when the user says 'is this done?', 'check this', 'verify this'. Do NOT trigger for active debugging (use debug), code review of others' code (use ce-code-review), or exploratory reading."
---

# Verify

Prove work is correct before claiming it's done. A claim without evidence is a guess.

## When to Use

- Finishing an implementation and about to declare it done
- User asks "is this done?", "check this", "verify this"
- Before marking a task or goal complete
- After a fix to confirm the original symptom is gone
- Before a PR or commit to catch issues before they leave the branch

## When NOT to Use

- Active debugging with a hypothesis in progress → use `debug`
- Code review of someone else's changes → use `ce-code-review`
- Exploratory reading to understand code → read directly, no skill needed
- User is asking you to *build* something, not check it → use `ce-work`

## Essential Principles

1. **Test against the original requirement, not the implementation.** Re-read what was asked for. Verify that behavior, not that your code runs. Code running is necessary but not sufficient. *Failure mode: "all tests pass" but the code doesn't do what was requested.*

2. **Run the actual tests, don't just reason about them.** Execute the test suite and read the output. "The logic looks right" is not verification. *Failure mode: a typo, import error, or silent exception that reasoning would miss.*

3. **Check the negative case.** For every claim of correctness, ask what would prove it wrong and check that. If you claim "X returns the correct value", verify what happens with empty input, null, edge cases. *Failure mode: the happy path works and the edge case crashes in production.*

4. **Verify no regressions.** Run the relevant test suite, not just the new test. A fix that breaks something else is not a fix. *Failure mode: PR that fixes one bug and introduces two.*

5. **State the evidence.** When reporting verification results, list what was tested, how, and the outcome. "Looks good" is not a verification result. *Failure mode: the user has to trust your confidence instead of your evidence.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "I just wrote it, I know it works" | You just wrote it — that makes you the worst person to judge it. Run the tests. |
| "The tests I wrote all pass" | Tests you wrote verify your understanding of the requirement. They may encode the same misunderstanding as the code. |
| "It worked when I tried it manually" | Manual testing samples one path. Automated tests sample many. Both are needed. |
| "This is a trivial change, verification is overkill" | Trivial changes are where regressions hide because nobody checks them. |
| "The user is waiting, I should ship fast" | Shipping a bug costs more time than the 60 seconds to verify. |

## Verification Checklist

Run these in order. Stop at the first failure.

1. **Requirement check.** Re-read the original request. Does the output match what was asked?
2. **Automated tests.** Run the relevant test suite. Do all tests pass?
3. **Edge cases.** Test empty input, null/undefined, boundary values, and error conditions.
4. **Regression check.** Run the broader suite. Did anything break?
5. **Manual smoke test.** Run the actual program or trigger the actual flow. Does it behave correctly end-to-end?
6. **Report.** State what was tested, what passed, what failed. If anything failed, do not claim done.
