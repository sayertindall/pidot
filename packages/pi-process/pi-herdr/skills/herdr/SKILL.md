---
name: herdr
description: "Control Herdr terminal topology: split panes, spawn coding agents, run shell commands. Use herdr_layout to create panes, herdr_pane for raw terminal control, herdr_agent for coding agent lifecycle management. Trigger when the user asks to split the terminal, open a side pane, spawn an agent in Herdr, or manage pane layouts."
---

# Herdr

Three tools for controlling Herdr's terminal topology. Create splits, run commands, and manage coding agent lifecycles — all from within a pi session running inside Herdr.

## Decision Tree

```
You need to do something in a Herdr pane
  │
  ├─ Create a new pane (split right or down)
  │   → herdr_layout({ action: "pane_split", direction: "right" })
  │
  ├─ Run a shell command
  │   → herdr_pane({ action: "run", pane: "<id>", command: "npm test" })
  │
  ├─ Spawn a coding agent (pi, claude, codex, etc.)
  │   → herdr_agent({ action: "start", pane: "<id>", kind: "pi", name: "reviewer" })
  │   → herdr_agent({ action: "prompt", target: "reviewer", prompt: "Review auth.ts" })
  │
  ├─ Read output from a pane
  │   → herdr_pane({ action: "read", pane: "<id>", source: "recent-unwrapped" })
  │
  ├─ Wait for output pattern
  │   → herdr_pane({ action: "wait_output", pane: "<id>", match: "Server running" })
  │
  └─ Send keys to a pane
      → herdr_pane({ action: "send_keys", pane: "<id>", keys: ["ctrl+c"] })
```

## Agent Lifecycle over Raw Pane

Use `herdr_agent` for coding agents (pi, claude, codex, cursor, gemini, and 15+ others). Use `herdr_pane` only for shells, servers, and non-agent CLIs.

```
// RIGHT — agent-aware lifecycle
herdr_agent({ action: "start", pane: "p1", kind: "pi", name: "reviewer" })
herdr_agent({ action: "prompt", target: "reviewer", prompt: "Review auth.ts", wait: true })
herdr_agent({ action: "read", target: "reviewer", lines: 80 })

// WRONG — raw text injection into an agent session
herdr_pane({ action: "send_text", pane: "p1", text: "Review auth.ts\n" })
```

`herdr_agent` understands agent lifecycle states (working, blocked, done, idle). It waits for settlement after prompts. Raw pane input can corrupt the agent's TUI state.

## Layout Patterns

**Side-by-side work** — split right for comparing or coordinating:

```
herdr_layout({ action: "pane_split", direction: "right" })
// New pane appears to the right. Good for: code review side-by-side,
// agent + shell, two agents coordinating.
```

**Logs below editor** — split down for build output:

```
herdr_layout({ action: "pane_split", direction: "down" })
// New pane appears below. Good for: test runners, dev servers,
// build watchers.
```

## Never Close Your Own Pane

`herdr_pane({ action: "close", pane: "<your-pane-id>" })` throws `"Refusing to close"`. You cannot self-destruct. Close only panes you created.

## Reading Output

Four snapshot sources:

| Source | What it captures |
|---|---|
| `visible` | Currently rendered viewport |
| `recent` | Last N lines of scrollback (wrapped) |
| `recent-unwrapped` | Raw scrollback (best for logs) |
| `detection` | Agent lifecycle detection snapshot |

Use `recent-unwrapped` for server logs, test output, transcripts. Use `visible` for quick checks. Use `wait_output` with a match pattern when you expect specific output.

## Agent Kinds

Supported: `pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, `maki`.

Agent names must match `[a-z][a-z0-9_-]{0,31}` — lowercase, no spaces.
