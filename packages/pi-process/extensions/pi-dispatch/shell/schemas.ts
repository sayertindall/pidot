/**
 * shell/schemas.ts
 *
 * TypeBox schemas: the `interactive_shell` tool parameters, and the on-disk
 * RunRecord shape state.ts validates against on read. Tool description and
 * parameter shape are ported unchanged from pi-shell-old/tool-schema.ts
 * (§8: public surface stays the same) except the spawn agent union, which
 * gains "gemini" (§2).
 */
import { Type } from "typebox";

export const TOOL_NAME = "interactive_shell";
export const TOOL_LABEL = "Interactive Shell";

export const TOOL_DESCRIPTION = `Run an interactive CLI coding agent in an overlay.

Use this ONLY for delegating tasks to other AI coding agents (Claude Code, Cursor CLI, Gemini CLI, Codex, etc.) that have their own TUI and benefit from user interaction.

DO NOT use this for regular bash commands - use the standard bash tool instead.

MODES:
- interactive (default): User supervises and controls the session
- hands-free: Agent monitors with periodic updates, user can take over anytime by typing
- dispatch: Agent is notified on completion via triggerTurn (no polling needed)
- monitor: Run in background and wake the agent on structured monitor events (stream, poll-diff, or file-watch)

RECOMMENDED DEFAULT FOR DELEGATED TASKS:
- For fire-and-forget delegations and QA-style checks, prefer mode="dispatch".
- Dispatch is the safest choice when the agent should continue immediately and be notified automatically on completion.

The user will see the process in an overlay. They can:
- Watch output in real-time
- Scroll through output (Shift+Up/Down)
- Transfer output to you (Ctrl+T) - closes overlay and sends output as your context
- Background (Ctrl+B) - dismiss overlay, keep process running
- Detach (Ctrl+Q) for menu: transfer/background/kill
- In hands-free mode: type anything to take over control

QUERYING SESSION STATUS:
- interactive_shell({ sessionId: "calm-reef" }) - get status + rendered terminal output (default: 20 lines, 5KB)
- interactive_shell({ sessionId: "calm-reef", outputLines: 50 }) - get more lines (max: 200)
- interactive_shell({ sessionId: "calm-reef", kill: true }) - end session
- interactive_shell({ sessionId: "calm-reef", input: "..." }) - send input

Examples:
- pi "Scan the current codebase"
- claude "Check the current directory and summarize"
- interactive_shell({ spawn: { agent: "codex" }, mode: "dispatch" })
- interactive_shell({ spawn: { agent: "gemini", prompt: "Review the diffs" }, mode: "dispatch" })
- interactive_shell({ spawn: { mode: "fork" } }) // pi-only fork of the current persisted session`;

const SpawnAgentSchema = Type.Union(
	[
		Type.Literal("pi"),
		Type.Literal("codex"),
		Type.Literal("claude"),
		Type.Literal("cursor"),
		Type.Literal("gemini"),
	],
	{ description: "Spawn agent to launch. Defaults to the configured spawn.defaultAgent." },
);

export const toolParameters = Type.Object({
	command: Type.Optional(
		Type.String({
			description: "The raw CLI command to run (e.g., 'pi \"Fix the bug\"'). Mutually exclusive with 'spawn'.",
		}),
	),
	spawn: Type.Optional(
		Type.Object(
			{
				agent: Type.Optional(SpawnAgentSchema),
				mode: Type.Optional(
					Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
						description: "Spawn mode. 'fork' is only supported for pi and requires a persisted current session.",
					}),
				),
				worktree: Type.Optional(
					Type.Boolean({ description: "Launch in a separate git worktree. Defaults to spawn.worktree from config." }),
				),
				prompt: Type.Optional(
					Type.String({ description: "Optional startup prompt using the agent's native prompt-bearing startup form." }),
				),
			},
			{ description: "Structured spawn request for pi, codex, claude, cursor, or gemini." },
		),
	),
	sessionId: Type.Optional(Type.String({ description: "Session ID to interact with an existing session." })),
	kill: Type.Optional(Type.Boolean({ description: "Kill the session (requires sessionId)." })),
	outputLines: Type.Optional(Type.Number({ description: "Lines to return when querying (default 20, max 200)." })),
	outputMaxChars: Type.Optional(Type.Number({ description: "Max chars to return (default 5KB, max 50KB)." })),
	outputOffset: Type.Optional(Type.Number({ description: "Line offset for pagination (0-indexed)." })),
	drain: Type.Optional(Type.Boolean({ description: "Return only NEW output since last query." })),
	incremental: Type.Optional(Type.Boolean({ description: "Return next N unseen lines; server tracks position." })),
	input: Type.Optional(Type.String({ description: "Raw text to send (requires sessionId). Does not submit." })),
	submit: Type.Optional(Type.Boolean({ description: "Press Enter after sending input (requires sessionId)." })),
	inputKeys: Type.Optional(Type.Array(Type.String(), { description: "Named keys with modifier support." })),
	inputHex: Type.Optional(Type.Array(Type.String(), { description: "Hex bytes as raw escape sequences." })),
	inputPaste: Type.Optional(Type.String({ description: "Bracketed-paste text." })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the command." })),
	name: Type.Optional(Type.String({ description: "Optional session name (used for session IDs)." })),
	reason: Type.Optional(Type.String({ description: "Brief explanation shown in the overlay header only." })),
	mode: Type.Optional(
		Type.Union(
			[Type.Literal("interactive"), Type.Literal("hands-free"), Type.Literal("dispatch"), Type.Literal("monitor")],
			{ description: "Supervision mode." },
		),
	),
	monitor: Type.Optional(
		Type.Object(
			{
				strategy: Type.Optional(
					Type.Union([Type.Literal("stream"), Type.Literal("poll-diff"), Type.Literal("file-watch")]),
				),
				triggers: Type.Array(
					Type.Object({
						id: Type.String(),
						literal: Type.Optional(Type.String()),
						regex: Type.Optional(Type.String()),
						cooldownMs: Type.Optional(Type.Number()),
						threshold: Type.Optional(
							Type.Object({
								captureGroup: Type.Number(),
								op: Type.Union([Type.Literal("lt"), Type.Literal("lte"), Type.Literal("gt"), Type.Literal("gte")]),
								value: Type.Number(),
							}),
						),
					}),
				),
				fileWatch: Type.Optional(
					Type.Object({
						path: Type.String(),
						recursive: Type.Optional(Type.Boolean()),
						events: Type.Optional(Type.Array(Type.Union([Type.Literal("rename"), Type.Literal("change")]))),
					}),
				),
				poll: Type.Optional(Type.Object({ intervalMs: Type.Optional(Type.Number()) })),
				persistence: Type.Optional(
					Type.Object({ stopAfterFirstEvent: Type.Optional(Type.Boolean()), maxEvents: Type.Optional(Type.Number()) }),
				),
				throttle: Type.Optional(
					Type.Object({ dedupeExactLine: Type.Optional(Type.Boolean()), cooldownMs: Type.Optional(Type.Number()) }),
				),
			},
			{ description: "Structured monitor configuration, required when mode='monitor'." },
		),
	),
	background: Type.Optional(Type.Boolean({ description: "Run headless, or dismiss an existing overlay." })),
	attach: Type.Optional(Type.String({ description: "Background session ID to reattach." })),
	listBackground: Type.Optional(Type.Boolean({ description: "List all background sessions." })),
	dismissBackground: Type.Optional(
		Type.Union([Type.Boolean(), Type.String()], { description: "Dismiss background sessions." }),
	),
	handsFree: Type.Optional(
		Type.Object({
			updateMode: Type.Optional(Type.String()),
			updateInterval: Type.Optional(Type.Number()),
			quietThreshold: Type.Optional(Type.Number()),
			gracePeriod: Type.Optional(Type.Number()),
			updateMaxChars: Type.Optional(Type.Number()),
			maxTotalChars: Type.Optional(Type.Number()),
			autoExitOnQuiet: Type.Optional(Type.Boolean()),
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "Auto-kill after N milliseconds." })),
});

// --- on-disk RunRecord (§5), snake_case ---

export const RunRecordSchema = Type.Object({
	schema_version: Type.Literal(1),
	record_id: Type.String(),
	launch_token: Type.String(),
	agent: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	command: Type.String(),
	exec_command: Type.String(),
	cwd: Type.String(),
	worktree: Type.Boolean(),
	worktree_path: Type.Optional(Type.String()),
	worktree_policy: Type.Union([Type.Literal("keep"), Type.Literal("prune-on-success"), Type.Literal("prune-always")]),
	supervision: Type.Union([
		Type.Literal("interactive"),
		Type.Literal("hands-free"),
		Type.Literal("dispatch"),
		Type.Literal("monitor"),
	]),
	completion_contract: Type.Union([Type.Literal("sentinel"), Type.Literal("exit-code")]),
	sentinel: Type.Optional(Type.String()),
	session_id: Type.String(),
	pty_pid: Type.Union([Type.Number(), Type.Null()]),
	pty_pgid: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	proc_identity: Type.Optional(Type.String()),
	status: Type.Union([
		Type.Literal("running"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("stopped"),
		Type.Literal("interrupted"),
	]),
	termination_cause: Type.Optional(Type.String()),
	evidence: Type.Optional(Type.String()),
	confidence: Type.Optional(Type.String()),
	exit_code: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	signal: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	monitor_events_tail: Type.Optional(Type.Array(Type.Unknown())),
	created_at: Type.String(),
	started_at: Type.String(),
	updated_at: Type.String(),
	ended_at: Type.Optional(Type.String()),
});
