/**
 * hooks.ts — Session lifecycle hooks
 *
 * - syncAlias: keep alias symlink in sync with current /name
 * - updateStatus: show session ID in status bar
 * - updateSessionEnv: export PI_SESSION_ID for child processes
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SocketState } from "./types";
import {
	createAliasSymlink,
	removeAliasesForSocket,
	isSafeAlias,
} from "./registry";

export { isSafeAlias };

const STATUS_KEY = "session-control";

export function getSessionAlias(ctx: ExtensionContext): string | null {
	try {
		const sessionName = ctx.sessionManager.getSessionName();
		const alias = sessionName ? sessionName.trim() : "";
		if (!alias || !isSafeAlias(alias)) return null;
		return alias;
	} catch {
		// ctx is stale after session replacement/reload — bail
		return null;
	}
}

/** Returns true if the context can be safely accessed. */
export function isContextActive(ctx: ExtensionContext): boolean {
	try {
		void ctx.sessionManager.getSessionId();
		return true;
	} catch {
		return false;
	}
}

export async function syncAlias(
	state: SocketState,
	ctx: ExtensionContext,
): Promise<void> {
	if (!state.server || !state.socketPath) return;
	if (!isContextActive(ctx)) return;

	const alias = getSessionAlias(ctx);
	if (alias && alias !== state.alias) {
		await removeAliasesForSocket(state.socketPath);
		await createAliasSymlink(ctx.sessionManager.getSessionId(), alias);
		state.alias = alias;
		return;
	}
	if (!alias && state.alias) {
		await removeAliasesForSocket(state.socketPath);
		state.alias = null;
	}
}

export function updateStatus(
	ctx: ExtensionContext | null,
	enabled: boolean,
): void {
	if (!ctx?.hasUI) return;
	if (!enabled) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const sessionId = ctx.sessionManager.getSessionId();
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `session ${sessionId}`));
}

export function updateSessionEnv(
	ctx: ExtensionContext | null,
	enabled: boolean,
): void {
	if (!enabled) {
		delete process.env.PI_SESSION_ID;
		return;
	}
	if (!ctx) return;
	process.env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
}
