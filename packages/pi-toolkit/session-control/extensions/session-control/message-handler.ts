/**
 * message-handler.ts — Inbound command dispatch
 *
 * Routes parsed RPC commands to individual handler functions.
 */

import type { Socket } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeResponse, writeEvent } from "./protocol";
import type {
	RpcCommand,
	RpcSendCommand,
	RpcSubscribeCommand,
	RpcUnsubscribeCommand,
	RpcForwardToolCommand,
	SocketState,
	SubagentResult,
} from "./types";
import { getLastAssistantMessage, getMessagesSinceLastPrompt, formatSummary } from "./summarizer";
import { syncAlias } from "./hooks";

// ─── Rate Limiting ────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(state: SocketState): boolean {
	const key = "global"; // simplified: one budget per server
	let limit = state.rateLimits.get(key);
	if (!limit) {
		limit = { messageTimestamps: [], subscriberCount: 0 };
		state.rateLimits.set(key, limit);
	}

	const now = Date.now();
	limit.messageTimestamps = limit.messageTimestamps.filter((t) => now - t < RATE_WINDOW_MS);

	if (limit.messageTimestamps.length >= DEFAULT_RATE_LIMIT) {
		return false;
	}

	limit.messageTimestamps.push(now);
	return true;
}

// ─── Response Helper ──────────────────────────────────────────────

function respond(
	socket: Socket,
	command: RpcCommand,
	success: boolean,
	data?: unknown,
	error?: string,
): void {
	const id = "id" in command && typeof command.id === "string" ? command.id : undefined;
	writeResponse(socket, {
		type: "response",
		command: command.type,
		success,
		data,
		error,
		id,
	});
}

// ─── Command Dispatcher ───────────────────────────────────────────

export async function handleCommand(
	pi: ExtensionAPI,
	state: SocketState,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	if (
		command.type !== "subscribe" &&
		command.type !== "unsubscribe" &&
		!checkRateLimit(state)
	) {
		respond(socket, command, false, undefined, "rate_limited");
		return;
	}

	const ctx = state.context;
	if (!ctx) {
		respond(socket, command, false, undefined, "Session not ready");
		return;
	}

	await syncAlias(state, ctx);

	// Subagent task interception — before normal send dispatch
	if (command.type === "send" && (command as any).metadata?.kind === "subagent-task") {
		const { runSubagentTask } = await import("./subagent-runner");
		await runSubagentTask(pi, ctx, (command as any).metadata, state);
		respond(socket, command, true, { delivered: true, mode: "subagent-task" });
		return;
	}

	switch (command.type) {
		case "send":
			await handleSend(pi, ctx, command, socket);
			break;
		case "get_message":
			await handleGetMessage(ctx, command, socket);
			break;
		case "get_summary":
			await handleGetSummary(ctx, command, socket);
			break;
		case "get_result":
			await handleGetResult(command, socket);
			break;
		case "clear":
			await handleClear(ctx, command, socket);
			break;
		case "abort":
			await handleAbort(ctx, command, socket);
			break;
		case "subscribe":
			await handleSubscribe(state, command, socket);
			break;
		case "unsubscribe":
			await handleUnsubscribe(state, command, socket);
			break;
		case "forward_tool":
			await handleForwardTool(ctx, command, socket);
			break;
		default:
			respond(socket, command, false, undefined, `Unsupported command: ${(command as RpcCommand).type}`);
	}
}

// ─── Handler: send ────────────────────────────────────────────────

async function handleSend(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	command: RpcSendCommand,
	socket: Socket,
): Promise<void> {
	const { message, mode = "steer", quiet = false } = command;

	if (typeof message !== "string" || message.trim().length === 0) {
		respond(socket, command, false, undefined, "Missing message");
		return;
	}

	const cleanMessage = stripSenderInfo(message);

	const customMessage = {
		customType: "session-message",
		content: cleanMessage,
		display: true,
	};

	if (quiet) {
		pi.sendMessage(customMessage as any, { triggerTurn: false });
	} else {
		const isIdle = ctx.isIdle();
		if (isIdle) {
			pi.sendMessage(customMessage as any, { triggerTurn: true });
		} else {
			pi.sendMessage(customMessage as any, {
				triggerTurn: true,
				deliverAs: mode === "follow_up" ? "followUp" : "steer",
			});
		}
	}

	respond(socket, command, true, { delivered: true, mode: "direct" });
}

// ─── Handler: get_message ─────────────────────────────────────────

async function handleGetMessage(
	ctx: ExtensionContext,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	const message = getLastAssistantMessage(ctx);
	respond(socket, command, true, { message: message ?? null });
}

// ─── Handler: get_summary ─────────────────────────────────────────

async function handleGetSummary(
	ctx: ExtensionContext,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	const messages = getMessagesSinceLastPrompt(ctx);
	if (messages.length === 0) {
		respond(socket, command, false, undefined, "No messages to summarize");
		return;
	}

	try {
		const { summary, model } = await formatSummary(ctx, messages);
		respond(socket, command, true, { summary, model });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Summarization failed";
		respond(socket, command, false, undefined, msg);
	}
}

// ─── Handler: get_result ──────────────────────────────────────────

let cachedResult: SubagentResult | null = null;

async function handleGetResult(
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	if (cachedResult) {
		respond(socket, command, true, { result: cachedResult });
		cachedResult = null;
	} else {
		respond(socket, command, true, { result: null });
	}
}

export function setPendingResult(result: SubagentResult): void {
	cachedResult = result;
}

// ─── Handler: clear ───────────────────────────────────────────────

async function handleClear(
	ctx: ExtensionContext,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	if (!ctx.isIdle()) {
		respond(socket, command, false, undefined, "Session is busy — wait for turn to complete");
		return;
	}

	const entries = ctx.sessionManager.getEntries();
	if (entries.length === 0) {
		respond(socket, command, false, undefined, "No entries in session");
		return;
	}

	const root = entries.find((e) => e.parentId === null);
	const firstEntryId: string | undefined = root?.id ?? entries[0]?.id;
	const currentLeafId = ctx.sessionManager.getLeafId();

	if (!firstEntryId) {
		respond(socket, command, false, undefined, "No root entry found");
		return;
	}

	if (currentLeafId === firstEntryId) {
		respond(socket, command, true, { cleared: true, alreadyAtRoot: true });
		return;
	}

	// Rewind to root (sessionManager is readonly typed, but rewindTo exists)
	try {
		const sm = ctx.sessionManager as unknown as { rewindTo(id: string): void };
		sm.rewindTo(firstEntryId);
		respond(socket, command, true, { cleared: true, targetId: firstEntryId });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Clear failed";
		respond(socket, command, false, undefined, msg);
	}
}

// ─── Handler: abort ───────────────────────────────────────────────

async function handleAbort(
	ctx: ExtensionContext,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	ctx.abort();
	respond(socket, command, true, {});
}

// ─── Handler: subscribe ───────────────────────────────────────────

async function handleSubscribe(
	state: SocketState,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	const sub = command as RpcSubscribeCommand;
	const id =
		typeof sub.id === "string"
			? sub.id
			: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	if (sub.event === "turn_end") {
		state.turnEndSubscriptions.push({ socket, subscriptionId: id });
		socket.once("close", () => {
			const idx = state.turnEndSubscriptions.findIndex((s) => s.subscriptionId === id);
			if (idx !== -1) state.turnEndSubscriptions.splice(idx, 1);
		});
		respond(socket, command, true, { subscriptionId: id, event: "turn_end" });
	} else if (sub.event === "result_ready") {
		state.resultReadySubscriptions.push({ socket, subscriptionId: id });
		socket.once("close", () => {
			const idx = state.resultReadySubscriptions.findIndex((s) => s.subscriptionId === id);
			if (idx !== -1) state.resultReadySubscriptions.splice(idx, 1);
		});
		respond(socket, command, true, { subscriptionId: id, event: "result_ready" });
	} else {
		respond(socket, command, false, undefined, `Unknown event type: ${sub.event}`);
	}
}

// ─── Handler: unsubscribe ─────────────────────────────────────────

async function handleUnsubscribe(
	state: SocketState,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	const { subscriptionId } = command as RpcUnsubscribeCommand;

	const turnIdx = state.turnEndSubscriptions.findIndex((s) => s.subscriptionId === subscriptionId);
	if (turnIdx !== -1) state.turnEndSubscriptions.splice(turnIdx, 1);

	const resultIdx = state.resultReadySubscriptions.findIndex((s) => s.subscriptionId === subscriptionId);
	if (resultIdx !== -1) state.resultReadySubscriptions.splice(resultIdx, 1);

	respond(socket, command, true, { removed: turnIdx !== -1 || resultIdx !== -1 });
}

// ─── Handler: forward_tool ─────────────────────────────────────────

async function handleForwardTool(
	_ctx: ExtensionContext,
	command: RpcCommand,
	socket: Socket,
): Promise<void> {
	const { tool } = command as RpcForwardToolCommand;

	if (!tool || typeof tool !== "string") {
		respond(socket, command, false, undefined, "Missing tool name");
		return;
	}

	// Phase 2: resolve tool from registered tools and execute directly.
	// For now, forward_tool is accepted but returns "not implemented".
	respond(socket, command, false, undefined, `forward_tool not yet implemented (Phase 2)`);
}

// ─── Helpers ──────────────────────────────────────────────────────

function stripSenderInfo(text: string): string {
	return text.replace(/<sender_info>[\s\S]*?<\/sender_info>/g, "").trim();
}

// ─── Event Firing ─────────────────────────────────────────────────

export function fireTurnEndEvents(state: SocketState, ctx: ExtensionContext): void {
	if (state.turnEndSubscriptions.length === 0) return;

	const lastMessage = getLastAssistantMessage(ctx);
	const eventData = { message: lastMessage, turnIndex: 0 };

	const subscriptions = [...state.turnEndSubscriptions];

	for (const sub of subscriptions) {
		writeEvent(sub.socket, {
			type: "event",
			event: "turn_end",
			data: eventData,
			subscriptionId: sub.subscriptionId,
		});
	}
}

export function fireResultReadyEvents(state: SocketState, result: SubagentResult): void {
	if (state.resultReadySubscriptions.length === 0) return;
	cachedResult = result;

	const subscriptions = [...state.resultReadySubscriptions];
	state.resultReadySubscriptions = [];

	for (const sub of subscriptions) {
		writeEvent(sub.socket, {
			type: "event",
			event: "result_ready",
			data: { runId: result.runId, result },
			subscriptionId: sub.subscriptionId,
		});
	}
}
