# pi-runtime-notrace

`/notrace` — generate a readable, self-contained HTML report of the current session.

## Usage

```
/notrace        # write report to ~/.pi/agent/pi-notrace/<sessionId>.html
/notrace open   # write report and open in default browser
```

## How it works

Each invocation reads the session JSONL, builds a structured report with sections for each event type (user messages, assistant turns, tool calls, etc.), renders it into a self-contained HTML file with dark-themed CSS, and writes it to `~/.pi/agent/pi-notrace/<sessionId>.html`.

The report is fully self-contained — no external CSS or JS. Open from `file://` and it renders.
