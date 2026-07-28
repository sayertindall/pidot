/**
 * status/types.ts
 *
 * In-memory types for the status footer extension. No persistent state;
 * the widget is rebuilt from the live session on every render.
 *
 * Stats are accumulated by walking `ctx.sessionManager.getBranch()` for
 * assistant messages and summing their usage objects. We don't persist
 * stats — they're trivially recomputable.
 */

export type StatusSnapshot = {
	readonly provider: string;
	readonly model: string;
	readonly modelId: string;
	readonly thinkingLevel: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cost: number;
	readonly contextTokens: number;
	readonly contextWindow: number;
	readonly sessionShortId: string;
	readonly gitBranch: string | null;
};

export type StatusRenderOptions = {
	readonly width: number;
	readonly hidden: boolean;
};
