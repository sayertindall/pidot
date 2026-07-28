## pi-runtime — long-lived resources, session lifecycle, persistent state

Each one either (a) opens something on `session_start` and closes it on `session_shutdown`, (b) maintains state across sessions, or (c) does I/O that touches the session log itself.

**1. `goal.ts` — keep working until the goal is actually done**
You run `/goal ship the auth refactor`. The agent goes. When it thinks it's done, it must audit: are tests passing? are files written? If yes, call `update_goal complete`. If no, keep going. When context fills up, the extension pauses, asks the agent to write a handoff, and starts a new linked session. The status is in the session log (`{ active, paused, budget_limited, handoff_started, complete, cleared }`), reconstructed on `session_start` by replaying the log. No separate JSON file. Widget shows "Goal: ship the auth refactor · 87%/95% · session 3." 700+ lines in the reference, single file.

**2. `worktree.ts` — move the session to another git checkout**
You're in `~/code/api/`, want to jump to `~/code/api/feature/auth`. You call `switch_worktree` (or run `/switch-worktree <path>`). The extension validates the target is a real non-bare git working tree, asks you to confirm, forks the session JSONL into a new file in the new directory, and continues the conversation there. History preserved. Module-scope boolean `pendingWorktreeSwitch` clears when you press Enter. 380 lines. No `~/.pi/agent/` state.

**3. `hermes-memory.ts` — SQLite memory that spans all your projects**
Different from per-project notes: this is your agent's cross-project long-term brain. SQLite at `~/.pi/agent/pi-hermes/memory.db`. Tools: `memory_add` (write a fact with tags), `memory_recall` (semantic + keyword search), `memory_list` (browse by tag/date), `memory_forget` (delete with optional undo). Opens the DB on `session_start`, closes on `session_shutdown`. WAL mode so multiple Pi instances can read at once. FTS5 index for keyword search. Optional embedding-based search later. Note: this is the **only** extension in the spec family justified using SQLite — cross-project scope, FTS queryability, multi-instance reads, schema migrations. No reference in `libs/`, this is a from-scratch design.

**4. `mcp-adapter.ts` — bridge to MCP servers**
Lots of tools live behind the Model Context Protocol (GitHub, Postgres, JIRA, etc.). Pi doesn't speak MCP natively. The adapter reads `~/.pi/mcp.json`, spawns the listed servers as subprocesses, registers their tools with Pi, and handles shutdown. OAuth tokens for servers that need them are stored encrypted at `~/.pi/agent/pi-mcp/oauth-tokens/`. On `session_start`: connect, discover, register. On `session_shutdown`: graceful close, idle timeout for stuck servers.

**5. `notrace.ts` — generate a readable HTML report of the session**
You run `/notrace` at the end of a session. It reads the session JSONL, summarizes the structure (turns, tools used, files touched, key decisions), and writes a self-contained HTML file to `~/.pi/agent/pi-notrace/<sessionId>.html`. No state, no lifecycle. Just a command that produces an artifact. Design TBD; no reference found.

**6. `quit-and-delete.ts` — throw away this session and exit**
Ctrl+Shift+X (configurable via `PI_QUIT_AND_DELETE_SHORTCUT`) deletes the session JSONL file and exits. Useful when the session went off the rails and you want to start fresh without a polluted history. 65 lines, one `registerShortcut` call. No state, but listed in pi-runtime because it's session-lifecycle-aware and core to the runtime feel.

## Package setup 

- **pi-runtime** = "system runs it on session hooks, or it manages resources that outlive a session, or it touches the session log itself." Defers resource opening to `session_start`, closes on `session_shutdown`, idempotent.
- **State location** = `~/.pi/agent/<extension-name>/` always. No root pollution. No `data/` subdir shared between extensions.
- **State patterns** = `appendEntry` for session-scoped state (goal, loop), JSON + atomic write for canonical state (mcp config, tilldone tasks), SQLite only for cross-project queryable memory (hermes), in-memory + marker files for transient clones (mcp server processes).
- **Subprocess calls** = `pi.exec` (Pi's own primitive, used by goal/worktree/mcp) or `execFileSync` with explicit args (no `shell: true`, ever). 30s default timeout, 64MB max buffer.
