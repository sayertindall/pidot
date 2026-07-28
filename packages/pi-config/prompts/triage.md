---
description: Classify a GitHub issue: determine type, severity, affected areas, and recommended next step.
argument-hint: "[issue-url]"
---

## /triage — Issue classification

Issue URL: $@

1. Fetch the issue body, comments, and labels.

2. Classify:
   - **Type**: bug / feature / docs / question / chore
   - **Severity**: blocker / major / minor / cosmetic
   - **Scope**: how many files, features, or areas would be touched
   - **Reproducible?**: yes / no / unclear (if bug)

3. If a bug: extract steps to reproduce, expected vs actual behaviour, environment hints.

4. If a feature request: summarise the ask, sketch the simplest viable implementation path, estimate complexity.

5. Produce a one-paragraph triage summary. Include: what should happen next, who should look at it, and whether this needs a /build or just a quick /fix.

Don't close the issue. Don't assign unless asked.
