/**
 * shell/types.ts
 *
 * In-memory (camelCase) types for the dispatch engine. The on-disk
 * RunRecord shape (snake_case) lives in schemas.ts as a TypeBox schema;
 * state.ts is the only module that translates between the two.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SupervisionMode = "interactive" | "hands-free" | "dispatch" | "monitor";

// gemini added here. It was never in the old code (config.ts had
// "pi"|"codex"|"claude"|"cursor" only). Add it everywhere SpawnAgent flows:
// commands, defaultArgs, and the tool schema union too, or
// resolveSpawn({agent:"gemini"}) builds a malformed command.
export type SpawnAgent = "pi" | "codex" | "claude" | "cursor" | "gemini";

export type TerminalStatus = "completed" | "failed" | "stopped" | "interrupted";

export type SpawnMode = "fresh" | "fork";

export type WorktreePolicy = "keep" | "prune-on-success" | "prune-always";

// --- monitor config (ported from pi-shell-old/types.ts) ---

export type MonitorStrategy = "stream" | "poll-diff" | "file-watch";
export type MonitorThresholdOperator = "lt" | "lte" | "gt" | "gte";

export interface MonitorThresholdConfig {
	captureGroup: number;
	op: MonitorThresholdOperator;
	value: number;
}

export interface MonitorTriggerConfig {
	id: string;
	literal?: string;
	regex?: string;
	cooldownMs?: number;
	threshold?: MonitorThresholdConfig;
}

export interface MonitorFileWatchConfig {
	path: string;
	recursive?: boolean;
	events?: Array<"rename" | "change">;
}

export interface MonitorConfig {
	strategy?: MonitorStrategy;
	triggers: MonitorTriggerConfig[];
	fileWatch?: MonitorFileWatchConfig;
	poll?: { intervalMs?: number };
	persistence?: { stopAfterFirstEvent?: boolean; maxEvents?: number };
	throttle?: { dedupeExactLine?: boolean; cooldownMs?: number };
}

export interface MonitorEventPayload {
	sessionId: string;
	eventId: number;
	timestamp: string;
	strategy: MonitorStrategy;
	triggerId: string;
	eventType: string;
	matchedText: string;
	lineOrDiff: string;
	stream: "pty";
}

export type MonitorTerminalReason = "stream-ended" | "script-failed" | "stopped" | "timed-out";

export interface MonitorSessionState {
	sessionId: string;
	strategy: MonitorStrategy;
	triggerIds: string[];
	status: "running" | "stopped";
	eventCount: number;
	startedAt: string;
	lastEventId?: number;
	lastEventAt?: string;
	lastTriggerId?: string;
	endedAt?: string;
	terminalReason?: MonitorTerminalReason;
	exitCode?: number | null;
	signal?: number;
}

// --- dispatch request/result, the ShellApi surface (§2) ---

export interface SpawnSpec {
	agent?: SpawnAgent;
	mode?: SpawnMode;
	worktree?: boolean;
	worktreePolicy?: WorktreePolicy;
	prompt?: string;
}

export interface HandsFreeSpec {
	autoExitOnQuiet?: boolean;
	gracePeriod?: number;
	updateMode?: "on-quiet" | "interval";
	updateInterval?: number;
	quietThreshold?: number;
	updateMaxChars?: number;
	maxTotalChars?: number;
}

export interface DispatchRequest {
	recordId: string;
	launchToken: string;
	command?: string;
	spawn?: SpawnSpec;
	cwd?: string;
	name?: string;
	reason?: string;
	/** Only meaningful with mode "dispatch" or "monitor": skip the overlay entirely, run headless from the start. */
	background?: boolean;
	mode: SupervisionMode;
	handsFree?: HandsFreeSpec;
	monitor?: MonitorConfig;
	timeout?: number;
}

export interface DispatchResult {
	status: TerminalStatus;
	result?: string;
	error?: string;
	sessionId: string;
	// legacy fields, preserved for the public interactive_shell tool result
	exitCode: number | null;
	signal?: number;
	cancelled: boolean;
	timedOut?: boolean;
}

export type InputSpec =
	| string
	| { text?: string; keys?: string[]; paste?: string; hex?: string[] };

export interface AttachResult {
	sessionId: string;
	handle: DispatchHandle;
}

export interface SessionSummary {
	sessionId: string;
	command: string;
	reason?: string;
	exited: boolean;
	startedAt: number;
	monitor?: MonitorSessionState;
}

// --- RunRecord (in-memory, camelCase). state.ts owns the on-disk
// (snake_case, schemas.ts:RunRecordSchema) <-> in-memory translation. ---

export type RunStatus = "running" | TerminalStatus;

export interface RunRecord {
	schemaVersion: 1;
	recordId: string;
	launchToken: string;
	agent?: string;
	task?: string;
	command: string;
	execCommand: string;
	cwd: string;
	worktree: boolean;
	worktreePath?: string;
	worktreePolicy: WorktreePolicy;
	supervision: SupervisionMode;
	completionContract: "sentinel" | "exit-code";
	sentinel?: string;
	sessionId: string;
	ptyPid: number | null;
	ptyPgid?: number | null;
	procIdentity?: string;
	status: RunStatus;
	terminationCause?: string;
	evidence?: string;
	confidence?: string;
	exitCode?: number | null;
	signal?: number | null;
	monitorEventsTail?: MonitorEventPayload[];
	createdAt: string;
	startedAt: string;
	updatedAt: string;
	endedAt?: string;
}

export interface DispatchHandle {
	readonly sessionId: string;
	readonly runToken: string;
	readonly settled: Promise<DispatchResult>;
	write(input: InputSpec): boolean;
	kill(cause: "agent_kill" | "user_kill"): void;
	suppressNotification(): void;
	events(): readonly MonitorEventPayload[];
}

// The typed programmatic surface. Callers that want a DispatchResult
// directly (a scheduler, a harness adapter) use this instead of parsing a
// tool-call result blob.
export interface ShellApi {
	dispatch(ctx: ExtensionContext, request: DispatchRequest): Promise<DispatchHandle>;
	attach(sessionId: string): Promise<AttachResult | undefined>;
	list(): readonly SessionSummary[];
	get(sessionId: string): DispatchHandle | undefined;
}

// --- overlay/UI state ---

export type DialogChoice = "kill" | "background" | "transfer" | "cancel" | "return-to-agent";
export type OverlayState = "running" | "exited" | "detach-dialog" | "hands-free";

export const FOOTER_LINES_COMPACT = 2;
export const FOOTER_LINES_DIALOG = 6;
export const HEADER_LINES = 4;

/** Format milliseconds to human-readable duration. */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

/** Format a key shortcut string for display (capitalize modifier names). */
export function formatShortcut(shortcut: string): string {
	return shortcut
		.replace(/ctrl/gi, "Ctrl")
		.replace(/shift/gi, "Shift")
		.replace(/alt/gi, "Alt");
}
