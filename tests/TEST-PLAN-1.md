# TEST-REQS.md

Core features and logic that must be tested per package. High-level only —
focus on "what should be verified" not "how to write the test."

---

## pi-memory (85%)

**What it does:** Cache-friendly tiered compaction with observations, reflections,
and a dropper pool. Replaces pi's built-in compaction with a V3 memory model that
observes the conversation, reflects on observations, and drops low-value entries.

### Must test

| # | Feature | Why |
|---|---------|-----|
| 1 | **Observer agent:** extracts correct observations from a chunk of conversation, assigns source entry IDs that exist in the chunk, rejects invented IDs, deduplicates identical content, produces stable 12-char hex IDs | This is the ingestion pipeline — if it hallucinates source IDs or drops content, the entire memory model corrupts |
| 2 | **Reflector agent:** produces reflections that only reference real observation IDs, respects the "supersession" frame (state changes), preserves user assertions verbatim | Reflections are the compression layer — bad reflections poison future context |
| 3 | **Dropper:** evicts observations when pool exceeds max tokens, respects relevance ordering, never drops observations still referenced by live reflections, writes `om.observations.dropped` entries | This is the memory budget enforcer — if it drops referenced observations, reflections become dangling and the model sees garbage |
| 4 | **Compaction hook:** produces valid `om.folded` details, covers the right entries, handles empty memory, handles V2→V3 migration, writes correct projections without applying new drops/reflections | This is what pi calls during compaction — if it returns bad data, pi's session summary is wrong |
| 5 | **Consolidation trigger:** fires observer → reflector → dropper in sequence, tracks in-flight state, debounces correctly, handles errors at each stage without losing data | This is the main loop — if it double-fires or silently drops errors, memory drifts |
| 6 | **Session ledger:** folds/unfolds entries correctly in `/om:view`, renders summaries with correct observation/reflection counts, computes progress and coverage stats | User-facing UI — if it miscounts, users lose trust |
| 7 | **Recall tool:** finds observations/reflections by ID, returns correct source context, handles missing IDs gracefully | The retrieval path — if it returns wrong data, `recall()` feeds bad context to the model |
| 8 | **Config:** validates `observationsPoolMaxTokens`, `consolidationThreshold`, model selection, falls back to session model when configured model is unavailable | Misconfiguration = silent failure in production |

---

## pi-toolkit (78%)

### tilldone

| # | Feature | Why |
|---|---------|-----|
| 1 | **Task CRUD:** add, done, update, list, clear, next/prev — all state transitions correct, task ordering preserved | Core data model — wrong ordering breaks the workflow |
| 2 | **Gate execution:** shell command must exit 0 before task can be marked done, gate failures block completion, gate timeouts handled | The enforcement mechanism — broken gates = tasks marked done without verification |
| 3 | **Tool registrations:** `tilldone_add`, `tilldone_done`, `tilldone_update`, `tilldone_list` are callable, parameters validated, tool results reflect state changes | These are what the LLM calls — if tools silently no-op, the model thinks tasks were created |
| 4 | **Widget rendering:** status strip shows correct in-progress/done counts, empty state renders cleanly, overflow handled | User-facing UI in the TUI |
| 5 | **Command handler:** `/tilldone` shows task list, args parsed correctly | User-facing command |

### loop

| # | Feature | Why |
|---|---------|-----|
| 1 | **Loop lifecycle:** starts, runs N iterations, stops on breakout condition, respects max iterations | Core loop — infinite loops are catastrophic |
| 2 | **Breakout detection:** `signal_loop_success` tool actually stops the loop, multiple calls handled correctly | The only exit path — if it doesn't work, loop never ends |
| 3 | **Summarizer:** produces useful summary after each iteration, handles empty turns, handles error turns | Feeds the model context for next iteration |
| 4 | **Preset loading:** all presets load correctly, invalid preset names handled | Configuration surface |

### qna

| # | Feature | Why |
|---|---------|-----|
| 1 | **Question extraction:** parses structured questions from LLM output, handles malformed responses, handles multi-question responses | Core parsing — bad extraction = user sees gibberish |
| 2 | **UI component:** renders questions inline, captures answers, handles timeout, handles escape/cancel | The TUI interaction — broken UI = user can't answer |
| 3 | **Last-message detection:** correctly identifies when model calls `ask_question` vs regular tool calls | Routing logic |

### coach

| # | Feature | Why |
|---|---------|-----|
| 1 | **Prompt extraction:** pulls coach instructions from AGENTS.md or `.pi/COACH.md`, handles missing files | Configuration ingestion |
| 2 | **Summarization:** condenses conversation for coach context, respects token budget | Memory management for the coach prompt |
| 3 | **Command handler:** `/coach` triggers correctly, args route to right mode | User-facing command |
| 4 | **Rendering:** coach messages styled distinctly from regular messages | Visual distinction in TUI |

### clean-sessions

| # | Feature | Why |
|---|---------|-----|
| 1 | **Candidate discovery:** finds all sessions, computes age/size, respects exclusions | If it misses sessions, cleanup is incomplete |
| 2 | **Scoring:** correctly weights age, size, activity — produces stable ordering | Determines what gets deleted |
| 3 | **Trash workflow:** moves to trash, restores from trash, permanent delete after confirmation | Destructive operations — bugs = data loss |
| 4 | **Command handler:** `/clean-sessions` with dry-run, confirm, execute modes | User-facing command |

### find-session

| # | Feature | Why |
|---|---------|-----|
| 1 | **Search:** finds sessions by name, age, working directory — fuzzy matching works, empty results handled | Core feature |
| 2 | **UI component:** renders search results, handles selection, handles empty state | TUI interaction |
| 3 | **Session switching:** selected session loads correctly, error on missing file handled | Session replacement path |

---

## pi-runtime (68%)

### goal

| # | Feature | Why |
|---|---------|-----|
| 1 | **Goal lifecycle:** create → track → update → complete — state machine transitions are valid, duplicate creates rejected, completing non-existent goal fails | Core state machine |
| 2 | **Handoff:** generates self-contained prompt with objective, completed work, decisions, and next action — prompt includes all required sections | Handoff prompt is the contract with the next session |
| 3 | **Usage tracking:** context usage reported correctly, triggers handoff at budget threshold | Triggers automatic handoff |
| 4 | **Tool registrations:** `create_goal`, `update_goal`, `goal_handoff`, `get_goal` — all callable with correct parameters | LLM-callable tools |
| 5 | **Widget:** status bar shows active goal, empty state when no goal | User-facing UI |

### notrace

| # | Feature | Why |
|---|---------|-----|
| 1 | **Extraction:** pulls notrace blocks from conversation, handles malformed blocks, handles empty blocks | Core parsing |
| 2 | **Template rendering:** templates expand correctly with session/model/provider data | Template engine |
| 3 | **IO:** reads/writes notrace files correctly, handles missing directories, handles permission errors | File I/O |
| 4 | **Command:** `/notrace` triggers correctly with subcommands | User-facing command |

### worktree

| # | Feature | Why |
|---|---------|-----|
| 1 | **Worktree creation:** creates git worktree, validates path, handles existing worktree, handles non-git directories | Core feature — broken creation = confusing git state |
| 2 | **Session relocation:** `switch_worktree` tool moves session to worktree, validates target is a git worktree | Session continuity |
| 3 | **Validation:** rejects bare repos, rejects non-git directories, rejects paths outside worktree | Safety — preventing bad git states |

### quit-and-delete

| # | Feature | Why |
|---|---------|-----|
| 1 | **Command handler:** `/quit-and-delete` with confirmation flow, deletes session file after quit, handles missing session file | Destructive operation — bugs = data loss |
| 2 | **Confirmation:** requires explicit confirmation before delete, cancel aborts cleanly | Safety gate |

---

## pi-config (40%)

**What it does:** Central config extension that bundles safety, review, enhance,
preset, context7, and status subsystems.

### _shared (foundations)

| # | Feature | Why |
|---|---------|-----|
| 1 | **State store:** reads/writes JSON state files atomically, handles concurrent access, handles corrupt files, handles missing files | Every subsystem depends on this |
| 2 | **IO:** file discovery in config dirs, path resolution (global vs project-local), respects `PI_CODING_AGENT_DIR` | Resource loading |
| 3 | **Validation:** TypeBox schemas validate config correctly, useful error messages on invalid config | Configuration safety |

### safety

| # | Feature | Why |
|---|---------|-----|
| 1 | **Command matching:** patterns match dangerous commands correctly (rm -rf, sudo, chmod 777, curl | bash, etc.) — no false negatives on known-dangerous patterns | The security boundary |
| 2 | **Blocking:** dangerous commands actually blocked, safe commands pass through, confirmation flow works when enabled | Enforcement |
| 3 | **Command registration:** `/safety` shows rules, allows temporary disable | User-facing command |

### review

| # | Feature | Why |
|---|---------|-----|
| 1 | **Selector resolution:** file selectors (@, globs, directories) expand correctly, handle missing files, handle permission errors | Core review targeting |
| 2 | **Target discovery:** finds reviewable files in project, respects .gitignore, handles large repos | Review scope |
| 3 | **Command handler:** `/review` with file args, with selectors, with no args (defaults to cwd) | User-facing command |

### enhance

| # | Feature | Why |
|---|---------|-----|
| 1 | **Prompt rewriting:** transforms user prompts via active preset, handles empty input, handles very long input | Core feature |
| 2 | **Preset cycling:** `/enhance` switches between presets, unknown preset names handled | Configuration |
| 3 | **State:** active preset persisted correctly across sessions | Persistence |

### preset

| # | Feature | Why |
|---|---------|-----|
| 1 | **Preset loading:** loads from global and project dirs, validates preset structure, handles malformed presets | Configuration ingestion |
| 2 | **Preset application:** injects correct system prompt modifications, respects thinking level settings | Core feature |
| 3 | **Command:** `/preset` lists, enables, disables presets | User-facing command |

### context7

| # | Feature | Why |
|---|---------|-----|
| 1 | **Library search:** `search_lib` returns ranked results, handles empty queries, handles network errors | LLM-callable tool |
| 2 | **Library lookup:** `lookup_lib` returns docs for a library ID, handles invalid IDs, handles rate limits | LLM-callable tool |
| 3 | **Command:** `/context7` with search/lookup subcommands | User-facing command |

### status

| # | Feature | Why |
|---|---------|-----|
| 1 | **Status display:** shows correct provider/model/thinking level/token usage, updates on model switch and turn end | The status line users see constantly |
| 2 | **UI rendering:** status line fits terminal width, truncates gracefully, colors respect theme | Visual correctness |
| 3 | **Command:** `/status` shows detailed info | User-facing command |

---

## pi-subagents (30%)

**What it does:** Subagent spawning framework — discovers agent definitions,
schedules concurrent subagents, manages state, joins results.

| # | Feature | Why |
|---|---------|-----|
| 1 | **Session runner:** spawns a subagent via `createAgentSession`, injects correct system prompt + tools, streams events, collects result, **handles timeouts, handles model errors, handles abort signals** | This is the core — 741 lines, zero tests. If this breaks, agents silently fail or hang |
| 2 | **Agent discovery:** loads agent definitions from project `.pi/agents/`, user `~/.pi/agent/agents/`, and bundled defaults — `DEFAULT_AGENTS` has correct tools, project agents opt-in correctly, duplicates resolved correctly | Discovery is the entry point |
| 3 | **Scheduling:** concurrent agent cap enforced, FIFO ordering, abort propagates to all running agents, `runBatch` returns `PromiseSettledResult[]` | Concurrency control — cap violations = resource exhaustion |
| 4 | **Group join:** collects results from multiple agents, handles partial failures, produces merged result | Multi-agent orchestration |
| 5 | **State management:** agent state transitions (queued → running → done/error), state file written atomically, recovery from partial state | Durable execution |
| 6 | **Worktree isolation:** agent runs in git worktree, changes committed to branch on completion, cleanup on abort, handles pre-existing branches | git isolation — broken cleanup = stale worktrees |
| 7 | **RPC harness:** spawns `pi --mode rpc` subprocess, JSONL framing correct, stdin/stdout management, process exit handling | Process boundary — if framing is off, RPC breaks |

---

## pi-process (22%)

**What it does:** Process, pane, and CLI-delegation orchestration. The PTY dispatch
engine, tmux control, SSH remote execution, and Herdr integration.

### pi-dispatch (CRITICAL — zero tests, 5,264 lines)

| # | Feature | Why |
|---|---------|-----|
| 1 | **PTY spawn:** spawns interactive CLIs (pi, claude, codex, cursor, gemini) in a real PTY, stdin/stdout wired correctly, process exits cleanly on kill, handles process crash | The core — if PTY I/O breaks, nothing works |
| 2 | **Supervision modes:** interactive (user controls), hands-free (agent monitors), dispatch (fire-and-forget with completion trigger), monitor (stream/poll-diff/file-watch triggers) — each mode transitions correctly, user takeover works in hands-free, dispatch fires trigger on completion | Four distinct modes, each with different control flow |
| 3 | **Monitor triggers:** stream matching (literal/regex), poll-diff detection, file-watch (rename/change events) — triggers fire correctly, cooldown respected, threshold comparisons work (lt/lte/gt/gte on capture groups) | The automation surface — broken triggers = missed events or spam |
| 4 | **Frame parsing:** ANSI/control sequences parsed correctly, output lines rendered faithfully, scrollback works, incremental/drain query modes return correct slices | Rendering fidelity |
| 5 | **Overlay management:** overlay opens/closes, backgrounding works, attach/detach, list/dismiss background sessions | TUI integration |
| 6 | **Session lifecycle:** sessions create, run, complete, timeout, kill — state machine is correct, no leaked processes, no orphaned PTYs | Process lifecycle — leaks = zombie processes |
| 7 | **Key encoding:** special keys (Ctrl+*, Alt+*, function keys) encoded correctly for each target CLI, modifier combinations work | Input fidelity — wrong encoding = keys don't work in the child CLI |
| 8 | **Config:** agent-specific spawn configs, worktree integration, default modes, environment passing | Configuration surface |

### pi-ssh

| # | Feature | Why |
|---|---------|-----|
| 1 | **Profile loading:** SSH profiles from `~/.ssh/config` and pi config, hostname/user/key resolution correct | Configuration |
| 2 | **Remote execution:** commands execute on remote host, output captured correctly, exit codes propagated, timeout handling, connection failure handling | Core feature |
| 3 | **Path translation:** local paths translated to remote paths correctly, handles home directory expansion | Path fidelity |
| 4 | **Command registration:** `/ssh` with profile selection, command execution | User-facing command |

### pi-tmux

| # | Feature | Why |
|---|---------|-----|
| 1 | **Pane operations:** create, split, kill, select — all tmux commands constructed correctly, error handling for missing panes/sessions | Core tmux control |
| 2 | **Command registration:** `/tmux` with subcommands, inside/outside tmux detection | User-facing command |

### pi-herdr

| # | Feature | Why |
|---|---------|-----|
| 1 | **Environment detection:** activates only when `HERDR_ENV=1` and `HERDR_PANE_ID` are set | Gate |
| 2 | **Herdr integration:** sends commands to herdr, parses responses, handles herdr errors | Core integration |
| 3 | **Command registration:** `/herdr` command with subcommands | User-facing command |

### _shared

| # | Feature | Why |
|---|---------|-----|
| 1 | **Safe exec:** `execFileSync` wrapper with timeout, maxBuffer, error capture — no shell injection, non-zero exit captures stdout | Security-sensitive utility used by all process extensions |
| 2 | **Run record:** records process runs (command, exit code, timing), serialization round-trips | Auditing |
| 3 | **Confirmation:** destructive operation confirmation flow, cancel works, timeout works | Safety gate |

---

## Summary by criticality

| Priority | Package / Area | Reason |
|----------|---------------|--------|
| **P0** | pi-dispatch (PTY engine) | 5,264 lines, zero tests, powers `interactive_shell` — the most complex and dangerous code in the repo |
| **P0** | pi-subagents session-runner | 741 lines, zero tests, core subagent spawn path |
| **P1** | pi-config extension entry points | 7 index.ts files untested — no verification that tools/commands actually register |
| **P1** | pi-memory observer/reflector/dropper integration | Unit tests exist but no integration test of the full consolidation loop with real `createAgentSession` |
| **P1** | pi-process safe-exec | Used by every process extension — bugs here affect ssh, tmux, herdr, dispatch |
| **P2** | pi-config review selectors/targets | Untested — core review targeting logic |
| **P2** | pi-toolkit render modules | UI rendering untested across clean-sessions, coach |
| **P3** | pi-runtime notrace test script | Tests exist but not wired to `pnpm -r test` |
| **P3** | pi-process pi-ssh/pi-tmux test scripts | Tests exist but not wired to `pnpm -r test` |