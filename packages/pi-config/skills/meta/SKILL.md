---
name: meta
description: "Decision gate: check skill descriptions before acting. Trigger at the start of every turn or task when the user's request could match a skill. Also trigger for 'which skill should I use?', 'is there a skill for this?'. Do NOT trigger for follow-up steps within an already-active skill workflow, or for trivial single-action requests that no skill covers."
---

# Meta

Before acting, check whether a skill applies. This is not a workflow — it is a decision gate that routes to the right skill or confirms no skill is needed.

## When to Use

- Start of a new user request or task
- User says "which skill should I use?", "is there a skill for this?"
- The request sounds like it might match one or more skill descriptions
- After a task completes and the next step is unclear — re-check
- You are about to dive into work without checking if a structured approach exists

## When NOT to Use

- You are mid-execution inside an already-active skill → stay in that skill
- The request is a trivial single action with no matching skill → just do it
- User explicitly said "don't use a skill for this" → respect that
- You are being asked a factual question with no decision component → answer directly

## Essential Principles

1. **Check descriptions before acting.** Read the `description` field of every available skill. Match against the user's request. If a description says "trigger when" and the request matches, activate the skill. *Failure mode: reinventing a workflow that already exists, inconsistently.*

2. **One skill at a time.** If multiple skills could apply, pick the most specific one. A skill designed for the exact situation beats a general one. If truly ambiguous, ask the user. *Failure mode: mixing two skills creates a hybrid workflow neither author tested.*

3. **No skill match is valid output.** "No applicable skill" is a successful decision. The gate exists to route when a skill fits, not to force a skill onto every request. *Failure mode: stretching a skill's trigger criteria to fit a request it wasn't designed for.*

4. **Re-check on context switch.** When the user changes topic or the task completes, re-evaluate. The skill that applied to the previous step may not apply to the next. *Failure mode: staying in debug mode when the user moved on to planning.*

5. **Read the full skill before executing.** Matching a description is the entry point. Read the entire SKILL.md before following it — the principles and anti-patterns sections contain constraints the description can't summarize. *Failure mode: activating a skill but violating its core principles because you only read the trigger line.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "I already know what this skill does" | Skills evolve. The description may have changed since you last read it. Check. |
| "This is simple, no skill needed" | Simple tasks are where process is most valuable — they're easy to rush and get wrong. |
| "I'll just use the skill I used last time" | The user's current request is not the user's previous request. Match fresh. |
| "Reading all descriptions takes too long" | There are fewer than 15 skills. Reading descriptions takes under 30 seconds. |
| "I can combine two skills for this" | Combined skills create untested workflows. Pick the best fit, or ask. |

## Decision Flow

1. **Get available skills.** List all SKILL.md files available to the session.
2. **Read descriptions.** Extract the `description` field from frontmatter for each.
3. **Match against the request.** For each skill, ask: does the request contain a positive trigger phrase? Does it avoid all negative triggers?
4. **Rank matches.** Prefer specificity. A skill that names the exact task beats a skill that broadly covers the domain.
5. **Decide.** Activate the best match, or proceed without a skill if none matches. State the decision explicitly before acting.
