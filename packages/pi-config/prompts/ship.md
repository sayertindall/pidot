---
description: Review the working tree then commit. Read-only audit, then propose a commit message and push plan.
argument-hint: ""
---

## /ship — Review-then-commit workflow

**Phase 1 — Review**
1. Read the diff of uncommitted changes.
2. Check for: leftover debug prints, commented code, TODOs that should block shipping, secrets in diffs, missing error handling.
3. Grade the diff as clean / small issues / needs rework.
4. If issues found, list each with a file:line and ask for confirmation before proceeding.

**Phase 2 — Commit**
1. Propose a commit message (conventional commits style).
2. Summarise the diff in 2-3 sentences — what changed and why.
3. Ask if I want to amend, squash, or commit as-is.
4. On my go: stage and commit.

Don't commit if unrelated files are dirty. Don't push without asking.
