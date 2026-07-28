/**
 * types.ts
 *
 * In-memory (camelCase) types for the subagent orchestration engine.
 * On-disk shapes (snake_case) live in schema.ts as TypeBox schemas; state.ts
 * is the only module that translates between the two. See SUB-SPEC-v4.md §2.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

export type { ThinkingLevel };

/** Agent type: any string name (the three embedded defaults, or a user-defined name). */
export type SubagentType = string;

/** The three embedded default agents, always available regardless of project config. */
export const DEFAULT_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

/**
 * Tool names registered by this extension's own tool surface (spawn / result /
 * steer). Subagents must never inherit these -- a subagent that could spawn or
 * steer other subagents would defeat the point of scoping. Single source of
 * truth: discovery.ts (tool-scope enforcement), session-runner.ts (session
 * construction), and index.ts (tool registration) all import from here.
 */
export const SUBAGENT_TOOL_NAMES = {
	AGENT: "Agent",
	GET_RESULT: "get_subagent_result",
	STEER: "steer_subagent",
} as const;

/** Names of tools registered by this extension that subagents must NOT inherit. */
export const EXCLUDED_TOOL_NAMES: string[] = Object.values(SUBAGENT_TOOL_NAMES);

/** Persistent agent memory scope. */
export type MemoryScope = "user" | "project" | "local";

/** Isolation mode for agent execution. Only "worktree" exists today. */
export type IsolationMode = "worktree";

/** How a background agent's completion should be delivered. See runtime.ts's GroupJoinManager wiring. */
export type JoinMode = "async" | "group" | "smart";

/** Persistent above-editor widget visibility. "background" hides foreground agents
 * (they already render inline as the Agent tool result) but keeps isBackground===undefined
 * agents visible -- only an explicit `false` is excluded. See ui.ts. */
export type WidgetMode = "all" | "background" | "off";

/**
 * Contract-layer terminal status, shared with the rest of the pi-process/
 * pi-subagents spec family. The runtime's own AgentRecord.status is richer
 * (see RuntimeStatus below); this is the collapsed four-state view other
 * packages key off. See SUB-SPEC-v4.md §2.4 for the exact mapping and why
 * "interrupted" is never produced by the in-process harness.
 */
export type TerminalStatus = "completed" | "failed" | "stopped" | "interrupted";

/** Reason a `stopped` terminal status was reached. Distinguishes a human/parent-signal
 * interrupt from the turn-limit hard-abort -- both collapse to `stopped` at the contract
 * layer, but the reason survives as metadata. See SUB-SPEC-v4.md §2.4. */
export type StoppedReason = "user" | "turn-limit";

/** The runtime's own status vocabulary (AgentRecord.status), richer than TerminalStatus.
 * Two non-terminal (queued, running), five terminal. */
export type RuntimeStatus = "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";

/** Unified agent configuration -- used for both the three embedded defaults and user-defined agents. */
export interface AgentConfig {
	name: string;
	displayName?: string;
	description: string;
	builtinToolNames?: string[];
	/** Raw `ext:` selector entries from the `tools:` CSV, e.g. ["ext:foo", "ext:bar/x"].
	 * Presence of any entry flips extension tools to an explicit allowlist. */
	extSelectors?: string[];
	/** Tool denylist -- removed even if builtinToolNames or extensions would include them. */
	disallowedTools?: string[];
	/** true = inherit all, string[] = only listed, false = none. */
	extensions: true | string[] | false;
	/** Extension-name denylist applied after the extensions include set. Exclude wins. */
	excludeExtensions?: string[];
	skills: true | string[] | false;
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	/** Persist this subagent as a normal on-disk pi session instead of in-memory only. */
	persistSession?: boolean;
	sessionDir?: string;
	systemPrompt: string;
	promptMode: "replace" | "append";
	inheritContext?: boolean;
	runInBackground?: boolean;
	isolated?: boolean;
	memory?: MemoryScope;
	isolation?: IsolationMode;
	isDefault?: boolean;
	enabled?: boolean;
	source?: "default" | "project" | "global";
}

/** Resolved spawn params, captured for UI display. Fixed at spawn time. */
export interface AgentInvocation {
	modelName?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	isolated?: boolean;
	inheritContext?: boolean;
	runInBackground?: boolean;
	isolation?: IsolationMode;
}

/** Worktree info attached to a record running with isolation: "worktree". See worktree.ts. */
export interface WorktreeInfo {
	path: string;
	branch: string;
	baseSha: string;
	workPath: string;
}

export interface WorktreeCleanupResult {
	hasChanges: boolean;
	branch?: string;
	path?: string;
}

export interface LifetimeUsage {
	input: number;
	output: number;
	cacheWrite: number;
}

export interface AgentRecord {
	id: string;
	type: SubagentType;
	description: string;
	status: RuntimeStatus;
	result?: string;
	error?: string;
	toolUses: number;
	startedAt: number;
	completedAt?: number;
	session?: AgentSession;
	abortController?: AbortController;
	promise?: Promise<string>;
	groupId?: string;
	joinMode?: JoinMode;
	/** Set once the result has been consumed via get_subagent_result -- suppresses a duplicate notification. */
	resultConsumed?: boolean;
	/** Steering messages queued before the session was ready. */
	pendingSteers?: string[];
	worktree?: WorktreeInfo;
	worktreeResult?: WorktreeCleanupResult;
	toolCallId?: string;
	lifetimeUsage: LifetimeUsage;
	compactionCount: number;
	/** Tri-state, set at spawn from SpawnOptions.isBackground: true = background,
	 * false = foreground (has an inline Agent tool-result surface), undefined = caller
	 * never declared it. The widget's background-only filter excludes only explicit
	 * `false`, so undefined agents stay visible. */
	isBackground?: boolean;
	invocation?: AgentInvocation;
}

/** Details attached to custom notification messages for visual rendering. */
export interface NotificationDetails {
	id: string;
	description: string;
	status: string;
	toolUses: number;
	turnCount: number;
	maxTurns?: number;
	totalTokens: number;
	durationMs: number;
	error?: string;
	resultPreview: string;
	others?: NotificationDetails[];
}

/**
 * A subagent spawn registered to fire on a schedule. Stored at
 * `<cwd>/.pi/subagent-schedules/<sessionId>.json`. Session-scoped: survives
 * /resume but resets on /new. See schedule.ts, state.ts.
 */
export interface ScheduledSubagent {
	id: string;
	name: string;
	description: string;
	/** Raw user input: cron expr | "+10m" | ISO | "5m". */
	schedule: string;
	scheduleType: "cron" | "once" | "interval";
	intervalMs?: number;

	subagentType: SubagentType;
	prompt: string;
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	isolated?: boolean;
	isolation?: IsolationMode;

	enabled: boolean;
	createdAt: string;
	lastRun?: string;
	lastStatus?: "success" | "error" | "running";
	nextRun?: string;
	runCount: number;
}

export interface ScheduleStoreData {
	version: 1;
	jobs: ScheduledSubagent[];
}

/** Event emitted on `pi.events` for cross-extension consumers of the scheduler. */
export type ScheduleChangeEvent =
	| { type: "added"; job: ScheduledSubagent }
	| { type: "removed"; jobId: string }
	| { type: "updated"; job: ScheduledSubagent }
	| { type: "fired"; jobId: string; agentId: string; name: string }
	| { type: "error"; jobId: string; error: string };

// --- LaunchConfig: the three-harness dispatch union. See SUB-SPEC-v4.md §2.1. ---

export interface PiLaunchConfig {
	harness: "pi";
	agentType: SubagentType;
	prompt: string;
	description: string;
	cwd?: string;
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	isolated?: boolean;
	inheritContext?: boolean;
	runInBackground?: boolean;
	isolation?: IsolationMode;
	joinMode?: JoinMode;
}

export interface InteractiveShellLaunchConfig {
	harness: "interactive-shell";
	recordId: string;
	launchToken: string;
	name: string;
	task: string;
	cwd: string;
	agent: "claude" | "codex" | "cursor" | "gemini" | "pi";
	worktree?: boolean;
	supervision: "dispatch" | "monitor";
}

export interface PiRpcLaunchConfig {
	harness: "pi-rpc";
	taskName: string;
	message: string;
	agentType?: string;
	cwd: string;
	parentSessionId: string;
	inheritedProvider: string;
	inheritedModelId: string;
	inheritedThinking?: ThinkingLevel;
	inheritedTools?: string;
}

export type LaunchConfig = PiLaunchConfig | InteractiveShellLaunchConfig | PiRpcLaunchConfig;

/** Shared result shape across all three harnesses. */
export interface HarnessResult {
	status: TerminalStatus;
	stoppedReason?: StoppedReason;
	steered?: boolean;
	result?: string;
	error?: string;
	agentId: string;
}
