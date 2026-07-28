---
description: Parallel subagent exploration of the codebase. Spawns independent agents to analyse different facets, then synthesises their findings.
argument-hint: ""
---

## /council — Parallel codebase exploration

Use subagent parallel dispatch to explore the current codebase.

1. Identify 3-5 facets worth independent investigation: architecture, data flow, testing, configuration, open questions.

2. Spawn one subagent per facet. Each reads broadly, then reports concise findings with file:line evidence.

3. Wait for all subagents to finish.

4. Synthesise results into:
   - What's clear and consistent
   - What's inconsistent or surprising
   - What needs attention or has no owner

5. Summarise in under 300 words. Link back to each subagent's findings for detail.

Pick facets that are orthogonal — if two agents would read the same files, merge them.
