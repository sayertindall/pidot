---
name: orient
description: "Read project context before changing anything. Trigger before editing code in an unfamiliar project, after switching repositories, or when the user says 'look at this codebase', 'figure out how this works', 'get oriented'. Do NOT trigger for small edits in a project you already understand, or when the user points to a specific file and line to change."
---

# Orient

Understand the project before touching it. Read the signals the authors left — README, AGENTS.md, package files, conventions. Prevent "looks orthogonal" mistakes by checking what's actually there.

## When to Use

- Starting work in a project or repository for the first time
- Switching back to a project after significant time away
- User says "look at this codebase", "figure out how this works", "get oriented"
- Before making changes that span multiple files or modules
- The project structure is unclear and you are guessing about dependencies
- Before proposing a refactor or architectural change

## When NOT to Use

- Making a small, localized edit in a project you already understand → just edit
- User points to a specific file and line and says "change X to Y" → do it
- You are mid-session and already oriented in this codebase → skip
- The request is purely conversational (asking a question about the project) → answer from what you know, orient only if needed
- You need to search for a specific symbol → use grep/read directly
- The design approach is unclear even after orienting → use `brainstorm` to explore options
- You have a confirmed design and need ordered implementation steps → use `plan`

## Essential Principles

1. **Read the project signals before reasoning.** README.md, AGENTS.md, CONTRIBUTING.md, SYSTEM.md, package.json, and any top-level config files. These contain intentional decisions. Guessing before reading is gambling. *Failure mode: proposing a pattern the project explicitly rejected in AGENTS.md, losing credibility and time.*

2. **Understand the dependency graph before editing.** What imports what? Which modules are leaf nodes vs. core plumbing? Editing a core module without understanding its callers creates cascading breaks. *Failure mode: "small change" to a shared utility breaks three unrelated features.*

3. **Match the existing conventions, even if you disagree.** Naming, file structure, error handling patterns, test style — do it their way. Conformance inside the codebase beats personal taste. *Failure mode: introducing a second pattern for the same thing, doubling cognitive load for future readers.*

4. **Identify the test infrastructure before writing code.** How are tests run? What framework? Where do test files live? What's the convention for test names? Write a test the way the project writes tests, or don't write one at all. *Failure mode: writing tests in a framework the project doesn't use, creating dead files.*

5. **Check the git log for recent changes in the area you're touching.** A file that looks stable may have been churned last week. Understanding recent intent prevents reverting deliberate changes. *Failure mode: "cleaning up" code that was intentionally structured that way three commits ago.*

## Rationalizations to Reject

| Shortcut | Why It's Wrong |
|----------|----------------|
| "This looks like a standard project setup" | Every project has deviations. The interesting parts — the ones you'll trip on — are in those deviations. |
| "I can figure it out as I go" | Discovering conventions by breaking them and getting PR feedback is slower than reading them upfront. |
| "The user is waiting, I should start coding" | 60 seconds of reading prevents the 10-minute fix for the bug you introduced by not reading. |
| "I already worked on a similar project" | Similar is not same. Conventions, dependencies, and decisions differ. Read this project's files. |
| "I'll just search for the file I need" | A file in isolation tells you what it does, not how it fits. Read the project signals for context. |

## Orientation Checklist

Run these in order. Stop when you have enough context to act safely.

1. **Top-level signals.** Read README.md and AGENTS.md if they exist. These are the project's "welcome mat" and rulebook.
2. **System identity.** Read SYSTEM.md or equivalent. This defines how agents should behave in this project.
3. **Package manifest.** Read package.json, Cargo.toml, go.mod, or equivalent. Understand dependencies and scripts.
4. **Directory map.** List the top-level directory tree. Identify the major modules and their roles.
5. **Conventions.** Check for .editorconfig, biome.json, eslint config, or equivalent. Note formatting and linting rules.
6. **Test infrastructure.** Find the test directory and framework. Run the tests to confirm they pass before you start.
7. **Recent changes.** `git log --oneline -10` in the area you'll touch. Note any active refactors or hotfixes.
8. **State readiness.** After orienting, state what you learned before acting. "This is a TypeScript project using Biome for formatting, tests in vitest, with a rule against cross-package imports. Proceeding."
