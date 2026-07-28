---
name: debug
description: "Evidence-first debugging: reproduce, narrow, falsify. Trigger when the user reports a bug, crash, error trace, test failure, or unexpected behavior. Also trigger for 'why is this failing', 'debug this', 'trace this error'. Do NOT trigger for feature requests, code review, refactoring, or general 'how does this work' questions — use ce-work, ce-code-review, or direct reading instead."
---

# Debug

Reproduce, narrow, falsify. Find the root cause before touching any code.

## When to Use

- User reports a bug, crash, or unexpected behavior
- User pastes a stack trace, error message, or test failure
- User says "debug this", "why is this failing", "trace this error"
- An issue reference is provided (GitHub, Linear, Jira)
- Prior fix attempts failed and investigation is stuck

## When NOT to Use

- Feature requests → use `ce-work` or `ce-plan`
- Code review feedback → use `ce-code-review`
- "How does this code work?" → read the code directly, no skill needed
- Refactoring or cleanup → use `ce-work`
- Performance tuning without a specific failure → investigate directly

## Essential Principles

1. **Reproduce before reasoning.** Run the failing case and confirm the symptom with your own eyes. Reasoning from a bug report without reproduction generates hypotheses about a bug that may not exist. *Failure mode: chasing a misdescribed symptom, wasting time on phantom bugs.*

2. **One hypothesis, one change.** Change exactly one thing to test one hypothesis. Multiple simultaneous changes make it impossible to know which fixed it (or masked it). *Failure mode: "something I did worked but I don't know what" — the bug is still there, hidden.*

3. **Trace upstream from the symptom.** Start at the error and follow the call chain backward until you find where valid state first became invalid. Do not stop at the first function that looks wrong — that's often where the problem is *observed*, not where it *originates*. *Failure mode: fixing the symptom while the root cause remains active.*

4. **State your assumptions and verify them.** List what must be true for your hypothesis to hold. Mark each as *verified* (you checked) or *assumed*. Assumptions are where investigations stall. *Failure mode: building a correct hypothesis on a wrong assumption, then calling the hypothesis wrong.*

5. **Do not propose a fix until the causal chain has no gaps.** "X somehow leads to Y" is a gap. If you cannot explain every link from trigger to symptom, you are not ready to fix. *Failure mode: PR that "fixes" a symptom while the real cause persists and will resurface.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "The error message says X, so the fix is obvious" | Error messages describe symptoms. The root cause is often elsewhere in the call chain. |
| "I'll just try changing this and see if it helps" | That is shotgun debugging. If it works, you learned nothing. If it masks the bug, it will return. |
| "The user said it's in this file" | Users report where they see the break. The cause is usually upstream. |
| "This is a simple bug, I can skip reproduction" | Simple bugs are the easiest to misdiagnose because you skip the step that would tell you you're wrong. |
| "I already know the answer from the stack trace" | Stack traces show the *last* frame where the error surfaced, not the frame that caused it. |

## Execution Flow

### 1. Triage

Parse the input into a problem statement. If an issue reference is provided, fetch it and read the full thread — late comments often contain updated reproduction steps or pivots in suspected cause.

### 2. Reproduce

Confirm the bug exists. Run the test, trigger the error, follow the reported steps. If it doesn't reproduce after 2-3 attempts, check for environment differences (stale deps, wrong branch, missing env vars, stale build artifacts).

### 3. Trace

Start at the error surface and trace backward. Ask "where did this value come from?" at each step. Check recent changes in touched files. If the bug is a regression, consider `git bisect`.

### 4. Hypothesize

Form hypotheses ranked by likelihood. For each, state the causal chain from trigger to symptom. If any link is uncertain, state a prediction that must also be true. Test predictions before accepting.

### 5. Present findings before fixing

Show the user the root cause, the proposed fix, and the tests to add. Ask whether to proceed with the fix or stop at diagnosis.

### 6. Fix (if authorized)

Write a failing test first. Make one change. Verify the test passes. Run the broader suite for regressions. If the fix fails after 3 attempts, return to step 4 — the root cause was likely wrong.
