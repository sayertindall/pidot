---
name: plan
description: "Phased work with verifiable steps written to PLAN.md. Trigger when the user says 'make a plan', 'plan this out', 'what are the steps?', or when a task is too large for a single implementation pass. Also trigger after brainstorm when the direction is confirmed. Do NOT trigger for single-file changes, trivial fixes, or when the user explicitly says 'just do it'."
---

# Plan

Break work into ordered, verifiable steps. Write them to PLAN.md. Each step has a clear success criterion so you know when it's done.

## When to Use

- User says "make a plan", "plan this out", "what are the steps?"
- A task spans multiple files, modules, or implementation passes
- After a brainstorm session where the design direction was confirmed
- The user describes a feature that requires coordination across components
- Work is complex enough that you could lose track of what's done vs. remaining
- Before executing a multi-step implementation → plan first, code second

## When NOT to Use

- Single-file changes with one clear implementation path → just do it
- The design direction is still undecided → use `brainstorm` first, then plan
- Trivial fixes where the plan is the implementation → skip planning
- User says "just do it", "don't plan, execute" → respect that
- The task is a single git commit worth of work → commit is the plan
- Planning for the sake of planning with no execution follow-through → don't start

## Essential Principles

1. **Every step must be verifiable.** Each step ends with a concrete success criterion: a test that passes, a file that exists, a command that succeeds. "Refactor the auth module" is not a step. "Extract token validation into auth/validate.ts; all existing auth tests pass" is. *Failure mode: steps that feel done but aren't because "done" was never defined.*

2. **Order steps by dependency, not by module.** If step 3 needs the output of step 1, step 1 comes first. Don't group by file or component — group by what needs to exist before what. *Failure mode: implementing step 3 with a stub for step 1, then rewriting step 3 when step 1's real interface differs.*

3. **Write the plan to PLAN.md.** Plans in conversation scroll away. Plans in PLAN.md persist. The file is the source of truth for what's done and what's next. *Failure mode: mid-implementation, you forget step 4 existed and ship incomplete work.*

4. **Update PLAN.md as work progresses.** Mark steps complete as they finish. Add steps if the plan changes. If a step fails, note why and adjust. The plan is a living document, not a one-time artifact. *Failure mode: PLAN.md says "all done" but step 3 was silently skipped because it was hard.*

5. **One active step at a time.** Don't work on step 2 while step 1 is unverified. Parallel work hides integration issues. Finish and verify, then move on. *Failure mode: steps 2 and 3 both depend on step 1's design decision that changed mid-implementation.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "I'll keep the plan in my head" | Plans in your head evaporate on context switch. PLAN.md survives. |
| "The steps are obvious, I don't need to write them" | If they're obvious, writing them takes 30 seconds. If writing them is hard, they weren't obvious. |
| "I'll plan as I code" | Planning during coding conflates design with implementation. They're different activities. |
| "This is too small for a plan" | If it takes more than 5 minutes to implement, it benefits from 2 minutes of planning. |
| "Plans always change anyway" | Yes. That's why you write them down — so you can see what changed and why. |

## PLAN.md Format

```markdown
# Plan: [Brief description of the goal]

## Context
[What problem this solves, what constraints exist, what design was chosen]

## Steps

### 1. [Step name]
- **Action:** [What to do]
- **Verification:** [How to confirm it's done]
- **Status:** pending | in_progress | complete

### 2. [Step name]
- **Action:** [What to do, may reference output of step 1]
- **Verification:** [How to confirm it's done]
- **Status:** pending | in_progress | complete

## Notes
[Anything discovered during execution that future readers should know]
```

## Execution Flow

1. **Gather context.** If not already oriented, run `orient` first. You need to understand the codebase before you can plan changes to it.
2. **Define the goal.** One sentence. What does success look like?
3. **Decompose into steps.** Each step: action, verification, and dependency order. Steps should be completable in one focused session.
4. **Write PLAN.md.** Use the format above. Place it in the project root or a `plans/` directory.
5. **Confirm with user.** Present the plan. Let the user reorder, add, or remove steps before execution starts.
6. **Execute step by step.** Mark each complete as verified. Update if the plan shifts.
7. **Close out.** When all steps are complete, note the final state in PLAN.md and report completion.
