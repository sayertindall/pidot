# Spec: pi-runtime-goal

**Source:** `libs/pi-extensions/packages/pi-goal/index.ts` (830 lines)
**Package kind:** installable, no npm publish

## Architecture

State reconstructed from session log custom entries (`pi-goal:state`), not a separate JSON file. The extension replays entries on `session_start` to rebuild `GoalRuntimeState`.

Context budget monitoring on each `agent_settled`: if usage exceeds the configured threshold (default 95%), the extension pauses work and requests a handoff to a new linked session.

## Files

```
src/
├── types.ts          # GoalStatus, GoalStateEvent, GoalStateEntry, GoalRuntimeState
├── state.ts          # appendState, reconstructState, newGoalId, applyEntry
├── prompts.ts        # buildInitialPrompt, buildContinuationPrompt, buildBudgetPrompt, buildManualHandoffPrompt, buildSummary
├── usage.ts          # usageFields, formatPercent, formatContext
├── handoff.ts        # startDeferredHandoff, buildKickoffPrompt, appendGoalStateToSessionManager
├── widget.ts         # updateTui
├── tool.ts           # get_goal, create_goal, update_goal, goal_handoff tool registrations
├── command.ts        # /goal <subcommand> handler
└── index.ts          # factory, event handlers
```

## Key design decisions

- **appendEntry only, no JSON**: per family spec. Replay on session_start.
- **agent_settled event**: pi-coding-agent native event for turn boundaries.
- **controller.newSession**: captured ExtensionCommandContext reused for handoff.
- **Hidden user messages via display: false**: continuation prompts invisible to user.
- **Threshold default 95%**: configurable per-goal.
- **Session lineage**: tracked as parentSession → childSession in GoalRuntimeState.sessions.
