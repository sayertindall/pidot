import type { GoalRuntimeState } from "./types";

export interface ContextUsage {
	percent?: number | null;
	tokens?: number | null;
	contextWindow?: number | null;
}

export function usageFields(usage: ContextUsage | undefined, fallback?: GoalRuntimeState) {
	return {
		contextPercent: usage?.percent ?? fallback?.lastContextPercent ?? null,
		contextTokens: usage?.tokens ?? fallback?.lastContextTokens ?? null,
		contextWindow: usage?.contextWindow ?? fallback?.contextWindow ?? null,
	};
}

export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined) return "?";
	return `${Math.round(value)}%`;
}

export function formatContext(state: GoalRuntimeState): string {
	return `${formatPercent(state.lastContextPercent)} / ${state.thresholdPercent}%`;
}
