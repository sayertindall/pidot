---
description: Evidence-first debug and patch. Takes a symptom, reproduces it, narrows the root cause, then fixes.
argument-hint: "<symptom>"
---

## /fix — Debug-and-patch workflow

Symptom: $@

**Step 1 — Reproduce**
1. Run the failing command or test to capture exact error output.
2. Record what happened vs what should happen.

**Step 2 — Narrow**
1. Form a hypothesis. State it plainly.
2. Narrow with minimal experiments — check logs, inspect state, add targeted debug prints.
3. Falsify. If your hypothesis doesn't hold, state the new one and pivot.

**Step 3 — Fix**
1. Write the smallest patch that addresses the root cause.
2. Verify the fix reproduces no error.
3. Check you didn't break adjacent tests.

**Step 4 — Explain**
Summarise: root cause, the fix, and one thing I could do differently next time to catch this earlier.

If you can't reproduce after 5 minutes, stop and report what you've ruled out.
