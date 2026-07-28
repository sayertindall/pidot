# pi-runtime-goal

Goal tracking with automatic handoff at context budget thresholds.

## Features

- **Goal lifecycle**: Create → track → update → complete with validated state transitions
- **Handoff prompts**: Generates self-contained handoff with objective, completed work, decisions, next action
- **Context budget**: Triggers automatic handoff at configurable context usage threshold
- **Widget**: Status bar shows active goal, empty state when no goal
- **Error recovery**: `latestAssistantError` and `pauseAfterAgentError` hooks for resilience
- **Step queuing**: `maybeQueueNextStep` for sequential goal progression

## Structure

```
pi-runtime/goal/extensions/goal/
├── index.ts          # Extension entry — registers hooks, tools, commands
├── tool.ts           # get_goal, create_goal, update_goal, goal_handoff tools
├── command.ts        # /goal command handler
├── prompts.ts        # buildSummary, buildHandoffPrompt
├── state.ts          # Persistent state + reconstructState
├── widget.ts         # Status bar widget
├── types.ts          # GoalState, GoalRecord
└── usage.ts          # Context usage tracking
```

## Tools

| Tool | Description |
|---|---|
| `get_goal` | Get current goal summary |
| `create_goal` | Create a new goal |
| `update_goal` | Update an existing goal |
| `goal_handoff` | Generate a handoff prompt for the next session |

## Commands

| Command | Description |
|---|---|
| `/goal` | Show goal status (no args) or create/update (with text) |

## Hooks

| Hook | What it does |
|---|---|
| `session_start` | Reconstruct goal state from disk |
| `session_tree` | Track session tree relationships |
| `session_shutdown` | Clean up state |
| `agent_start` | Reset step tracking |
| `agent_settled` | Trigger `maybeQueueNextStep` |

## Handoff prompt structure

```
## Objective
[Current goal description]

## Completed work
[What was done, decisions made]

## Next action
[What the next session should do]

## Context
[Goal metadata, session info]
```

## Configuration

State persisted under `~/.pi/agent/pi-config/goal/` (cross-session).

## Limitations

- Goal state is per-session — handoff prompt is the only cross-session bridge
- Context budget threshold not user-configurable (uses pi's internal budget)
