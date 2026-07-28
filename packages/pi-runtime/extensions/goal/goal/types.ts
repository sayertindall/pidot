export type GoalStatus =
	| "active"
	| "paused"
	| "budget_limited"
	| "handoff_started"
	| "complete"
	| "cleared";

export type GoalStateEvent =
	| "created"
	| "status_changed"
	| "continued"
	| "budget_limited"
	| "handoff_requested"
	| "handoff_completed"
	| "completed"
	| "cleared";

export interface GoalStateEntry {
	version: 1;
	event: GoalStateEvent;
	goalId: string;
	objective?: string;
	status?: GoalStatus;
	thresholdPercent?: number;
	contextPercent?: number | null;
	contextTokens?: number | null;
	contextWindow?: number | null;
	sessionIndex?: number;
	parentSession?: string;
	currentSession?: string;
	handoffPrompt?: string;
	timestamp: number;
}

export interface GoalRuntimeState {
	goalId: string;
	objective: string;
	status: GoalStatus;
	thresholdPercent: number;
	sessionIndex: number;
	sessions: string[];
	parentSession?: string;
	currentSession?: string;
	lastContextPercent: number | null;
	lastContextTokens: number | null;
	contextWindow: number | null;
	lastHandoffPrompt?: string;
	continuationInFlight: boolean;
	handoffInFlight: boolean;
}
