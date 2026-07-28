---
name: recall
description: "Search memory before re-deciding. Trigger when about to recommend an approach, choose a library, set a convention, or answer a question that was likely discussed before. Also trigger for 'what did we decide about X?', 'did we already handle this?'. Do NOT trigger for genuinely new topics with no prior discussion, or when the user is asking you to search code (use grep/read directly)."
---

# Recall

Check what was already decided before making a recommendation. Re-deciding without recall wastes time and creates inconsistency.

## When to Use

- About to recommend an approach that may have been discussed before
- Choosing a library, tool, or pattern that the project may already have a convention for
- User asks "what did we decide about X?", "have we done this before?"
- A question comes up that feels like it was answered in a prior session
- Before setting a new convention that might conflict with an existing one

## When NOT to Use

- Genuinely new topic with no plausible prior discussion → decide directly
- User is asking you to search the codebase for a symbol → use grep/read directly
- User is asking about project structure you can see right now → read the files
- The answer is in the current conversation context → no search needed

## Essential Principles

1. **Search before recommending.** Before you suggest an approach, check whether one was already chosen. A project's history contains decisions that new reasoning may not account for. *Failure mode: recommending library B when library A was chosen last month for documented reasons.*

2. **Accept prior decisions unless given reason to overturn.** If a prior decision exists and still applies, follow it. Do not re-argue from first principles every time the topic comes up. *Failure mode: every session picks a different approach, creating inconsistent code.*

3. **Surface the prior decision to the user.** When you find a prior decision, state it clearly: what was decided, when, and why. Let the user confirm or explicitly override. *Failure mode: silently following a stale decision the user wanted to change.*

4. **Distinguish stale from still-valid.** A decision from 6 months ago may no longer apply if the codebase, team, or requirements changed. Note the context of the decision when you report it. *Failure mode: blindly following a decision made under conditions that no longer hold.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "I can just pick the best approach now" | You might be right, but you're also ignoring constraints and tradeoffs that were already weighed. Check first. |
| "The user is asking me to decide" | They're asking you to help decide. Part of helping is knowing what was already decided. |
| "Searching takes too long" | A 10-second search prevents a 10-minute re-decision and potential inconsistency. |
| "I remember we discussed this" | Your memory of prior conversations may be incomplete or wrong. Actually search. |
| "This is a different context" | Maybe. Check the prior decision's reasoning to confirm, don't assume. |

## Search Strategy

1. **Conversation history.** Check the current session and recent sessions for the topic.
2. **Project documentation.** Check ADRs, `docs/decisions/`, CONTRIBUTING.md, README conventions section, or any decision log the project maintains.
3. **Existing code.** Grep for the pattern or library in question — what's already in use is often the decision.
4. **Report findings.** State what you found, or state that no prior decision was found. Either way, proceed.