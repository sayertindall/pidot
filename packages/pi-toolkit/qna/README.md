# pi-toolkit-qna

Extract questions from the last assistant response and answer them interactively.

## What it does

You just got a long response with multiple questions embedded in it. Run `/qna`. The extension reads the last assistant message, pulls out the questions (line-based first, then LLM extraction if nothing local is found), and shows them in a TUI. Tab through, type answers, press Enter to advance. On the last question, confirm and the answers are sent back as a single user message.

## Install

```bash
pi install ./packages/pi-toolkit/qna
```

## Commands

| Command | Description |
|---|---|
| `/qna` | Extract questions from the last assistant message and answer them interactively. |

## Behavior

- **Local extraction first.** Lines ending in `?` (after stripping list markers like `-`, `*`, `•`, `1.`) are picked up directly, no LLM call.
- **LLM fallback.** If local extraction finds nothing, the extension asks a small model (Codex mini → Haiku → the active model) to extract questions.
- **Interactive TUI.** Tab/Enter to advance, Shift+Tab to go back, Shift+Enter for newlines, Esc to cancel. A confirmation dialog appears on the last question.

## License

MIT.
