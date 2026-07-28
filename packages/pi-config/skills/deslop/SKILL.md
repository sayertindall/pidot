---
name: deslop
description: "Remove AI code slop. Trigger when reviewing code for unnecessary comments that restate code, over-defensive error handling that obscures logic, redundant abstractions for single-use code, or verbose patterns that add no value. Also trigger for 'clean this up', 'this code is bloated', 'simplify this'. Do NOT trigger for adding features, fixing bugs, performance optimization, or writing new code (use ce-work)."
---

# Deslop

Remove code that exists only because an AI wrote it — not because the problem requires it.

## When to Use

- Reviewing code and spotting AI-generated bloat
- User says "clean this up", "this code is bloated", "simplify this", "too verbose"
- Before shipping code that was primarily AI-generated
- After a coding session produced noticeably padded output
- User asks to reduce code size without changing behavior

## When NOT to Use

- Adding new features → use `ce-work`
- Fixing bugs → use `debug`
- Performance optimization → that's a different skill
- Writing new code → write clean the first time, don't deslop after
- Code review for correctness → use `ce-code-review`

## Essential Principles

1. **Delete comments that restate the code.** `// increment counter` above `counter++` is noise. Delete it. A comment should explain *why*, not *what*. If the code needs a what-comment to be understood, the code needs better names, not a comment. *Failure mode: comments that drift out of sync with the code, becoming misleading.*

2. **Remove single-use abstractions.** A function called once, in one place, that's no clearer than inline code, is an abstraction serving no reader. Inline it. *Failure mode: jumping through three files to read five lines of logic.*

3. **Cut over-defensive code.** Try-catch blocks that catch everything and log it, null checks for values that cannot be null, early returns with no callers depending on that behavior. Defensive code that guards against nothing real is code the reader must verify is unnecessary — which is worse than no code at all. *Failure mode: bugs hidden by overly broad catch blocks that swallow real errors.*

4. **Remove redundant type annotations and casts.** If the language infers the type and the inference is correct, the annotation is noise. If a cast is to the same type the variable already is, remove it. *Failure mode: readers assume the annotation or cast is there for a reason and waste time looking for one.*

5. **Preserve behavior exactly.** Deslopping is a refactoring operation. The code must do the same thing after. If you cannot verify the behavior is identical, do not remove the code — it may not be slop. *Failure mode: removing code that looked like slop but was handling a real edge case.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "More comments = more documentation" | Comments that restate code are worse than no comments. They train readers to skip comments. |
| "The abstraction might be reused later" | YAGNI. Extract it when there's a second caller, not in anticipation. |
| "Defensive code is best practice" | Defensive code that guards against nothing is not defensive — it's distracting. |
| "This was auto-generated, it's fine" | Auto-generated code that humans must read and maintain is not fine. It's your responsibility now. |
| "Removing comments loses information" | If the comment contained information not in the code, it should be a why-comment. If it only contained what the code does, the information is already in the code. |

## What to Remove

- Comments restating what the code does
- Comments restating the function name as a header
- Try-catch blocks that catch all exceptions just to log them
- Null checks for values the type system guarantees are non-null
- Functions with one call site that are no clearer than inline code
- Type annotations where inference is obvious
- Variables assigned once and used once with a name identical to the value
- Boilerplate "error handling" that converts one error representation to an identical one

## What to Keep

- Comments explaining *why* (business rules, non-obvious constraints, historical context)
- Defensive code guarding against real failure modes the type system doesn't cover
- Abstractions with two or more call sites, or that substantially improve readability
- Error handling that translates between error domains or adds useful context
