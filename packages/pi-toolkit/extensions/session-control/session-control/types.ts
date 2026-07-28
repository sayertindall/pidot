/**
 * types.ts — Shared types for session-control
 *
 * Out-of-band metadata replaces the <sender_info> XML injection pattern.
 * All RPC commands carry a metadata field; the receiving session's handler
 * strips it before the model sees the message.
 */

// ─── RPC Envelope ────────────────────────────────────────────────

export interface RpcResponse {
	type: "response";
	command: string;
	success: boolean;
	error?: string;
	data?: unknown;
	id?: string;
}

export interface RpcEvent {
	type: "event";
	event: string;
	data?: unknown;
	subscriptionId?: string;
}

// ─── Command Types ───────────────────────────────────────────────

export interface RpcSendCommand {
	type: "send";
	message: string;
	mode?: "steer" | "follow_up";
	quiet?: boolean;
	metadata?: Record<string, unknown>;
	id?: string;
}

export interface RpcGetMessageCommand {
	type: "get_message";
	id?: string;
}

export interface RpcGetSummaryCommand {
	type: "get_summary";
	id?: string;
}

export interface RpcGetResultCommand {
	type: "get_result";
	id?: string;
}

export interface RpcClearCommand {
	type: "clear";
	id?: string;
}

export interface RpcAbortCommand {
	type: "abort";
	id?: string;
}

export interface RpcSubscribeCommand {
	type: "subscribe";
	event: "turn_end" | "result_ready";
	id?: string;
}

export interface RpcUnsubscribeCommand {
	type: "unsubscribe";
	subscriptionId: string;
	id?: string;
}

export interface RpcForwardToolCommand {
	type: "forward_tool";
	tool: string;
	args: Record<string, unknown>;
	id?: string;
}

export type RpcCommand =
	| RpcSendCommand
	| RpcGetMessageCommand
	| RpcGetSummaryCommand
	| RpcGetResultCommand
	| RpcClearCommand
	| RpcAbortCommand
	| RpcSubscribeCommand
	| RpcUnsubscribeCommand
	| RpcForwardToolCommand;

// ─── Subscription ─────────────────────────────────────────────────

export interface TurnEndSubscription {
	socket: import("node:net").Socket;
	subscriptionId: string;
}

export interface ResultReadySubscription {
	socket: import("node:net").Socket;
	subscriptionId: string;
}

// ─── Extracted Message ────────────────────────────────────────────

export interface ExtractedMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

// ─── Subagent Result ──────────────────────────────────────────────

export interface SubagentResult {
	runId: string;
	status: "completed" | "failed" | "stopped" | "interrupted";
	stoppedReason?: "user" | "turn-limit";
	output: string;
	toolCount: number;
	turnCount: number;
	tokenUsage?: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
	};
	error?: string;
	agentName: string;
	modelUsed: string;
}

// ─── Session Tags ─────────────────────────────────────────────────

export interface SessionTags {
	role?: string;
	pool?: string;
	project?: string;
	[key: string]: string | undefined;
}

// ─── Live Session Info ────────────────────────────────────────────

export interface LiveSessionInfo {
	sessionId: string;
	name?: string;
	aliases: string[];
	tags: SessionTags;
	socketPath: string;
}

// ─── Mailbox Message ──────────────────────────────────────────────

export interface MailboxMessage {
	queuedAt: number;
	retries: number;
	command: RpcSendCommand;
}

// ─── Rate Limit State ─────────────────────────────────────────────

export interface RateLimitState {
	messageTimestamps: number[];
	subscriberCount: number;
}

// ─── Subagent Task Metadata ──────────────────────────────────────

export interface SubagentTaskMetadata {
	kind: "subagent-task";
	runId: string;
	parentSessionId: string;
	parentKey: string;
	agentName: string;
	task: string;
	agentConfig: Record<string, unknown>;
	lifecycle: "single" | "pool";
}

// ─── Socket State ─────────────────────────────────────────────────

export interface SocketState {
	server: import("node:net").Server | null;
	socketPath: string | null;
	context: import("@earendil-works/pi-coding-agent").ExtensionContext | null;
	alias: string | null;
	aliasTimer: ReturnType<typeof setInterval> | null;
	gcTimer: ReturnType<typeof setInterval> | null;
	turnEndSubscriptions: TurnEndSubscription[];
	resultReadySubscriptions: ResultReadySubscription[];
	rateLimits: Map<string, RateLimitState>;
	tags: SessionTags;
}
