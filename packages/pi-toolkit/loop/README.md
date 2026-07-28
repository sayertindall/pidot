# pi-toolkit-loop

Follow-up loop that keeps the agent going until a breakout condition is met.

## Usage

```
/loop tests              # Loop until tests pass
/loop self               # Self-driven loop (agent decides when done)
/loop custom <condition>  # Loop until a custom condition is satisfied
```

Running `/loop` without arguments opens an interactive preset picker.

The agent calls `signal_loop_success` to stop the loop. If the last assistant response was aborted, the extension asks whether to break out.

## Install

```bash
pi install npm:pi-toolkit-loop
```

Or add to your `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```
