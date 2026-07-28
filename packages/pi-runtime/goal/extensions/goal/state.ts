import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRuntimeState, GoalStateEntry, GoalStateEvent } from "./types";

export const STATE_ENTRY = "pi-goal:state";
const DEFAULT_CONTEXT_THRESHOLD_PERCENT = 95;

let runtimeState: GoalRuntimeState | null = null;
let capturedCommandContext: ExtensionCommandContext | undefined;

export function getRuntimeState(): GoalRuntimeState | null {
	return runtimeState;
}

export function setRuntimeState(state: GoalRuntimeState | null): void {
	runtimeState = state;
}

export function getController(): ExtensionCommandContext | undefined {
	return capturedCommandContext;
}

export function setController(ctx: ExtensionCommandContext | undefined): void {
	capturedCommandContext = ctx;
}

export function clearController(): void {
	capturedCommandContext = undefined;
}

export function newGoalId(): string {
	return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function shortObjective(objective: string, max = 64): string {
	const oneLine = objective.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, max - 1)}…`;
}

export function goalSessionName(objective: string, sessionIndex: number): string {
	const base = `goal: ${shortObjective(objective, 52)}`;
	return sessionIndex <= 1 ? base : `${base} (${sessionIndex})`;
}

export function pushUnique(values: string[], value: string | undefined): void {
	if (!value || values.includes(value)) return;
	values.push(value);
}

export function updateUsage(state: GoalRuntimeState, usage: { percent?: number | null; tokens?: number | null; contextWindow?: number | null } | undefined): void {
	if (!usage) return;
	state.lastContextPercent = usage.percent ?? null;
	state.lastContextTokens = usage.tokens ?? null;
	state.contextWindow = usage.contextWindow ?? null;
}

export function isNonTerminal(state: GoalRuntimeState | null): boolean {
	return !!state && state.status !== "complete" && state.status !== "cleared";
}

function applyEntry(state: GoalRuntimeState | null, entry: GoalStateEntry): GoalRuntimeState | null {
	if (!entry || entry.version !== 1 || !entry.goalId) return state;

	if (!state || entry.event === "created" || state.goalId !== entry.goalId) {
		if (!entry.objective) return state;
		state = {
			goalId: entry.goalId,
			objective: entry.objective,
			status: entry.status ?? "active",
			thresholdPercent: entry.thresholdPercent ?? DEFAULT_CONTEXT_THRESHOLD_PERCENT,
			sessionIndex: entry.sessionIndex ?? 1,
			sessions: [],
			parentSession: entry.parentSession,
			currentSession: entry.currentSession,
			lastContextPercent: entry.contextPercent ?? null,
			lastContextTokens: entry.contextTokens ?? null,
			contextWindow: entry.contextWindow ?? null,
			lastHandoffPrompt: entry.handoffPrompt,
			continuationInFlight: false,
			handoffInFlight: entry.status === "budget_limited" || entry.status === "handoff_started",
		};
	}

	if (!state || state.goalId !== entry.goalId) return state;

	if (entry.objective) state.objective = entry.objective;
	if (entry.status) state.status = entry.status;
	if (entry.thresholdPercent) state.thresholdPercent = entry.thresholdPercent;
	if (typeof entry.sessionIndex === "number") state.sessionIndex = entry.sessionIndex;
	if (entry.parentSession) state.parentSession = entry.parentSession;
	if (entry.currentSession) state.currentSession = entry.currentSession;
	if (entry.contextPercent !== undefined) state.lastContextPercent = entry.contextPercent;
	if (entry.contextTokens !== undefined) state.lastContextTokens = entry.contextTokens;
	if (entry.contextWindow !== undefined) state.contextWindow = entry.contextWindow;
	if (entry.handoffPrompt) state.lastHandoffPrompt = entry.handoffPrompt;

	pushUnique(state.sessions, entry.parentSession);
	pushUnique(state.sessions, entry.currentSession);

	state.handoffInFlight = state.status === "budget_limited" || state.status === "handoff_started";
	return state;
}

export function reconstructState(ctx: ExtensionContext): GoalRuntimeState | null {
	let state: GoalRuntimeState | null = null;
	for (const entry of ctx.sessionManager.getBranch() as any[]) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
		state = applyEntry(state, entry.data as GoalStateEntry);
	}
	runtimeState = state;
	return state;
}

export function appendState(
	pi: ExtensionAPI,
	event: GoalStateEvent,
	patch: Partial<GoalStateEntry> = {},
): GoalStateEntry | null {
	const current = runtimeState;
	const goalId = patch.goalId ?? current?.goalId;
	if (!goalId) return null;

	const entry: GoalStateEntry = {
		version: 1,
		event,
		goalId,
		thresholdPercent: patch.thresholdPercent ?? current?.thresholdPercent ?? DEFAULT_CONTEXT_THRESHOLD_PERCENT,
		timestamp: Date.now(),
		...patch,
	};

	(pi as any).appendEntry(STATE_ENTRY, entry);
	runtimeState = applyEntry(runtimeState, entry);
	return entry;
}
