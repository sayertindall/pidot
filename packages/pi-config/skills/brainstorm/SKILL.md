---
name: brainstorm
description: "Design conversation before writing code. Explore options, evaluate tradeoffs, present alternatives. Trigger when the user says 'how should I build X?', 'what's the best way to...?', 'design a system for...', or when the problem has multiple valid approaches and no obvious winner. Do NOT trigger for trivial bug fixes, one-line changes, or when the user has already decided on an approach and just wants implementation."
---

# Brainstorm

Design before you code. Explore the problem space, surface tradeoffs, and present alternatives. Code is the last step, not the first.

## When to Use

- User says "how should I build X?", "what's the best way to...?"
- User says "design a system for...", "think through this problem"
- The problem has multiple valid approaches with no obvious winner
- The user is about to make a consequential architectural decision
- User asks "what are the tradeoffs?" or "what are my options?"
- The requirements are vague and need clarification through exploration

## When NOT to Use

- Trivial bug fixes with one obvious fix → just fix it
- One-line changes or typos → correct them directly
- User already decided on an approach and wants implementation → use `plan` then `ce-work`
- The question is factual, not a design choice → answer directly
- The codebase already has a clear convention for this → follow the convention, don't redesign
- User says "just do it" or "don't overthink this" → respect that

## Essential Principles

1. **Explore options before picking one.** Generate at least two distinct approaches. If you can only think of one, you haven't thought hard enough — ask what the opposite approach would be. *Failure mode: committing to the first idea that comes to mind, which is rarely the best.*

2. **State tradeoffs, not just preferences.** For each option, name what it optimizes for and what it sacrifices. "I prefer option A" is not analysis. "Option A optimizes for simplicity at the cost of flexibility; option B optimizes for extensibility at the cost of upfront complexity" is. *Failure mode: the user picks your favorite option without understanding what they're giving up.*

3. **Distinguish requirements from implementation details.** When the user describes a solution, extract the underlying need. "Add a cache" is an implementation. "Reduce response time under 100ms" is the requirement. Design for the requirement — the user's proposed solution may not be the best one. *Failure mode: building exactly what the user asked for instead of what they need.*

4. **Surface assumptions explicitly.** Every design has premises. List them: "This assumes the dataset fits in memory", "This assumes single-tenant deployment". If an assumption is wrong, the design is wrong. *Failure mode: the user approves a design that depends on an assumption that doesn't hold in their environment.*

5. **Present, then ask. Don't present and start coding.** After laying out options, pause. Let the user react. They may have context you don't that invalidates an option or elevates a tradeoff. *Failure mode: building option A while the user was about to say "option A won't work because..."*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "This is the obvious approach" | Obviousness is the #1 sign of unexplored alternatives. If it's truly obvious, stating why takes one sentence. |
| "The user seems impatient, I should just build" | Building the wrong thing wastes more time than a 60-second tradeoff discussion. |
| "I'll explore tradeoffs in the code" | Code locks you into a path. Tradeoffs explored in conversation are cheap to change. |
| "There's only one way to do this" | There is always another way. It might be worse — saying why it's worse is the analysis. |
| "The user asked me to build, not to discuss" | If the request is ambiguous or consequential, the user benefits from options they didn't know to ask for. |

## Brainstorming Flow

1. **Clarify the problem.** Restate what you heard. Separate requirements from the user's proposed solution.
2. **Generate alternatives.** Produce 2-4 distinct approaches. Different enough that they make different tradeoffs.
3. **Evaluate each.** For each option: what it optimizes for, what it sacrifices, what assumptions it makes, what the implementation surface looks like.
4. **Recommend with reasoning.** Pick one and explain why. The recommendation matters less than the reasoning — the user may override based on context you don't have.
5. **Pause for input.** Ask whether to proceed with the recommendation or explore further. Do not start coding until the user confirms the direction.
6. **Hand off to plan.** Once the direction is chosen, transition to `plan` for phased implementation steps.
