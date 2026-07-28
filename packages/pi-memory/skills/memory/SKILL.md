---
name: memory
description: "Recall observations and reflections from earlier in long conversations. Use recall_observation to retrieve facts extracted by the memory compaction pipeline. Trigger when the user references something from earlier ('remember when we discussed...', 'what was that thing about...'), when context may have been compacted away, or when working in very long sessions."
---

# Memory

Long sessions compact to stay within context windows. The memory pipeline observes, reflects, and drops entries — but key facts are preserved as observations with 12-char hex IDs. You can recall them.

## When to Recall

The user says something like:
- "Remember when we discussed the auth pattern earlier?"
- "What was the decision about the database schema?"
- "Go back to that thing about rate limiting"
- "You mentioned a file earlier — what was it?"

Long sessions where compaction may have dropped the relevant entries.

## How to Recall

```
recall_observation({ id: "a1b2c3d4e5f6" })
→ returns the observation text and source context
```

Observation IDs are 12-char hex strings. They appear in `/om:view` summaries and in the compaction fold markers. Treat them as opaque handles — don't try to decode or guess them.

## When NOT to Recall

- **Recent context**: if the discussion was within the last ~20 messages, it's probably still in context. Just reference it.
- **No specific ID**: don't call `recall_observation` speculatively. You need an ID from a prior `/om:view` or fold marker.

## Memory Status

```
/om:status
→ shows observation pool stats: count, token usage, drops
```

```
/om:view
→ session ledger with foldable entries, observation/reflection counts
```

Use `/om:view` when the user asks "what do we know so far?" or "summarize what we've covered."

## Passive Mode

If `PI_MEMORY_PASSIVE=1` is set, the memory pipeline still runs but suppresses worker notifications. Don't mention compaction or memory status unless the user explicitly asks.

## Observation IDs in Context

When compaction folds old entries, it includes a marker like:

```
[Earlier context compacted. Observations: a1b2c3, d4e5f6. Use recall_observation to retrieve.]
```

Save these IDs. They're your handles back to the compressed context.
