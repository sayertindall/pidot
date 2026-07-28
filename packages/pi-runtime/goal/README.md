# pi-runtime-goal

Long-running main-agent goal with automatic context-budget handoff.

`/goal ship the auth refactor` — the agent goes. When it thinks it's done, it must audit: are tests passing? are files written? If yes, call `update_goal complete`. If no, keep going. When context fills up, the extension pauses, asks the agent to write a handoff, and starts a new linked session.

## Install

```bash
pi install pi-runtime-goal
```

## Usage

```
/goal <objective>       Start or replace a goal
/goal                   Show goal summary
/goal pause             Pause the active goal
/goal resume            Resume a paused goal
/goal handoff           Request a manual handoff now
/goal clear             Clear the active goal
```

## Tools

- `get_goal` — Return current goal state, context usage, and session lineage.
- `create_goal` — Create a goal (prefer `/goal` for automatic session handoff).
- `update_goal` — Mark the goal complete (only `status: "complete"` accepted).
- `goal_handoff` — When context budget is reached, prepare a handoff for the next linked session.

## State

State lives in the session log as custom `pi-goal:state` entries. Reconstructed on `session_start` by replaying the branch. No separate JSON file.

Statuses: `active | paused | budget_limited | handoff_started | complete | cleared`.
