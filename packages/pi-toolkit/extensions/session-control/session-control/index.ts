/**
 * index.ts — Session Control Extension
 *
 * Always-on session bus. Every pi session with this extension loaded creates
 * a Unix domain socket and registers tools for inter-session communication.
 *
 * No --session-control flag needed. No <sender_info> XML injection.
 * Metadata travels out-of-band in the RPC envelope.
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import type { SocketState } from "./types";
import { ensureControlDir, drainMailbox, cleanupDeadSockets } from "./registry";
import { startControlServer, stopControlServer } from "./server";
import { syncAlias, updateStatus, updateSessionEnv } from "./hooks";
import { fireTurnEndEvents } from "./message-handler";
import { registerSendToSessionTool } from "./tools/send-to-session";
import { registerListSessionsTool } from "./tools/list-sessions";
import { registerControlSessionsCommand } from "./commands/control-sessions";
import { createSessionAutocompleteProvider } from "./autocomplete";

export default function sessionControlExtension(pi: ExtensionAPI): void {
	const state: SocketState = {
		server: null,
		socketPath: null,
		context: null,
		alias: null,
		aliasTimer: null,
		gcTimer: null,
		turnEndSubscriptions: [],
		resultReadySubscriptions: [],
		rateLimits: new Map(),
		tags: {},
	};

	// ─── Tool & Command Registration ───────────────────────────────

	registerSendToSessionTool(pi, state);
	registerListSessionsTool(pi);
	registerControlSessionsCommand(pi);

	// ─── Lifecycle Hooks ───────────────────────────────────────────

	const refreshServer = async (ctx: ExtensionContext) => {
		await startControlServer(pi, state, ctx.sessionManager.getSessionId());
		state.context = ctx;

		if (!state.aliasTimer) {
			state.aliasTimer = setInterval(() => {
				if (!state.context) return;
				try {
					void syncAlias(state, state.context);
				} catch {
					// context went stale — clear timer, session_start will recreate
					if (state.aliasTimer) {
						clearInterval(state.aliasTimer);
						state.aliasTimer = null;
					}
				}
			}, 1000);
		}

		if (!state.gcTimer) {
			state.gcTimer = setInterval(() => {
				void cleanupDeadSockets(7);
			}, 60_000);
		}

		updateStatus(ctx, true);
		updateSessionEnv(ctx, true);
	};

	pi.on("session_start", async (_event, ctx) => {
		await ensureControlDir();

		// Drain mailbox — deliver any messages queued while we were offline
		const messages = await drainMailbox(ctx.sessionManager.getSessionId(), 3);
		for (const cmd of messages) {
			pi.sendMessage(
				{
					customType: "session-message",
					content: cmd.message,
					display: true,
				} as any,
				{ triggerTurn: false },
			);
		}

		await refreshServer(ctx);

		if (ctx.hasUI) {
			ctx.ui.addAutocompleteProvider((current) =>
				createSessionAutocompleteProvider(current),
			);
		}
	});

	pi.on("session_shutdown", async () => {
		if (state.aliasTimer) {
			clearInterval(state.aliasTimer);
			state.aliasTimer = null;
		}
		if (state.gcTimer) {
			clearInterval(state.gcTimer);
			state.gcTimer = null;
		}
		// state.context may be stale — updateStatus/updateSessionEnv handle null
		if (state.context) {
			try {
				updateStatus(state.context, false);
			} catch { /* context already stale */ }
			try {
				updateSessionEnv(state.context, false);
			} catch { /* context already stale */ }
		}
		await stopControlServer(state);
		state.context = null;
	});

	// ─── Turn End Events ───────────────────────────────────────────

	pi.on("turn_end", (_event: TurnEndEvent, ctx: ExtensionContext) => {
		if (!state.context) return;
		void syncAlias(state, ctx);
		fireTurnEndEvents(state, ctx);
	});
}

// ─── Public API for other extensions ──────────────────────────────

export { getLiveSessions, isSocketAlive, getControlDir } from "./registry";
export { sendRpcCommand } from "./client";
export type { RpcClientOptions, RpcClientResult } from "./client";
export type {
	RpcCommand,
	RpcSendCommand,
	RpcResponse,
	RpcEvent,
	SocketState,
	LiveSessionInfo,
	SessionTags,
	SubagentResult,
} from "./types";
