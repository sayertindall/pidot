# pi-toolkit

Productivity tools that layer over pi's core agent loop. Run in-session — no
process management or inter-session communication overhead.

## Sub-packages

| Package | Description | Docs |
|---|---|---|
| `clean-sessions` | Delete old pi session files to free disk space | — |
| `coach` | Interactive coaching prompts for improving prompts/workflows | — |
| `find-session` | Search past sessions with ripgrep and resume a match | — |
| `loop` | Loop agent turns until a condition is met | — |
| `qna` | Q&A mode — ask a question, get an answer, exit | — |
| `session-control` | Always-on session bus — Unix socket RPC, subagent transport, offline mailbox, session tags, persistence | [pi-toolkit-session-control.md](pi-toolkit-session-control.md) |
| `tilldone` | Run until the agent declares work complete | — |

## Shared pattern

All pi-toolkit extensions:
- Self-contained — no dependencies on pi-process or pi-runtime subsystems
- Register tools or commands that affect the current session
- Use the standard `export default function(pi: ExtensionAPI)` entry point
