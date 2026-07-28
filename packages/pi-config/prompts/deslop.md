---
description: Clean up AI-generated code slop — remove speculative abstractions, redundant comments, and overly clever patterns.
argument-hint: ""
---

## /deslop — Code slop removal

Scan the staged diff or the last 5 files I touched. Look for:

1. **Speculative abstractions** — interfaces with one implementation, factory functions that return the same thing every time, inheritance that could be a flat function.

2. **Over-commenting** — `// increment i by 1` above `i++`, docstrings that restate the function signature, block comments explaining basic syntax.

3. **Defensive paranoia** — null checks on values that are never null, try/catch wrapping trivial operations, type guards on your own types.

4. **Unnecessary ceremony** — class wrappers around a pure function, builder pattern for 2 fields, dependency injection for a utility.

5. **AI-isms** — "as an AI", "I cannot", "it's important to note", "leverage", "utilize", "robust", "delve".

For each finding: show the offending snippet, explain why it's slop, then remove it. If nothing qualifies, say "clean" and stop.
