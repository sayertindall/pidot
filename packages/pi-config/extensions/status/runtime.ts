/**
 * status/runtime.ts
 *
 * Snapshot collector. Reads the live session and pi context to build a
 * `StatusSnapshot` for the widget renderer. No side effects, no I/O.
 *
 * Why a separate module: keeps the widget code free of model/usage
 * traversal, and makes the snapshot pure & testable.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StatusSnapshot } from "./types";

function getThinkingLevel(pi: ExtensionAPI, _ctx: ExtensionContext): string {
	return pi.getThinkingLevel() ?? "—";
}

type AssistantUsageLike = {
	usage?: {
		input?: number;
		output?: number;
		cost?: { total?: number };
	};
};

function sumUsage(branch: ReadonlyArray<unknown>): {
	input: number;
	output: number;
	cost: number;
} {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of branch) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as { type?: string; message?: { role?: string } & AssistantUsageLike };
		if (e.type !== "message") continue;
		if (e.message?.role !== "assistant") continue;
		const usage = e.message.usage;
		if (!usage) continue;
		input += usage.input ?? 0;
		output += usage.output ?? 0;
		cost += usage.cost?.total ?? 0;
	}
	return { input, output, cost };
}

function shortSessionId(id: string | undefined): string {
	if (!id) return "—";
	return id.length <= 8 ? id : id.slice(-8);
}

export function buildSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): StatusSnapshot {
	const branch = safeGetBranch(ctx);
	const { input, output, cost } = sumUsage(branch);

	const model = ctx.model;
	const sessionInfo = safeGetSessionInfo(ctx);
	const contextWindow = (model && "contextWindow" in model && typeof model.contextWindow === "number")
		? model.contextWindow
		: 0;

	return {
		provider: model?.provider ?? "—",
		model: model?.id ?? "—",
		modelId: model?.id ?? "—",
		thinkingLevel: getThinkingLevel(pi, ctx),
		inputTokens: input,
		outputTokens: output,
		cost,
		contextTokens: sessionInfo?.contextTokens ?? 0,
		contextWindow,
		sessionShortId: shortSessionId(sessionInfo?.sessionId),
		gitBranch: safeGetGitBranch(ctx),
	};
}

function safeGetBranch(ctx: ExtensionContext): ReadonlyArray<unknown> {
	try {
		return ctx.sessionManager.getBranch();
	} catch {
		return [];
	}
}

function safeGetSessionInfo(ctx: ExtensionContext): { sessionId?: string; contextTokens?: number } | null {
	try {
		return pi_getSessionInfo(ctx);
	} catch {
		return null;
	}
}

function safeGetGitBranch(ctx: ExtensionContext): string | null {
	try {
		const info = pi_getSessionInfo(ctx);
		return info?.gitBranch ?? null;
	} catch {
		return null;
	}
}

/** Wrap pi.getSessionInfo if present, else return null. */
function pi_getSessionInfo(ctx: ExtensionContext): { sessionId?: string; contextTokens?: number; gitBranch?: string } | null {
	const pi = ctx as unknown as { getSessionInfo?: () => unknown };
	if (typeof pi.getSessionInfo !== "function") return null;
	try {
		const info = pi.getSessionInfo();
		if (!info || typeof info !== "object") return null;
		return info as { sessionId?: string; contextTokens?: number; gitBranch?: string };
	} catch {
		return null;
	}
}
