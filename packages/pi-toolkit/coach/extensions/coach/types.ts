export type CoachScope = "current" | "all";

export interface SessionDigest {
	name: string | undefined;
	created: string;
	entryCount: number;
	branchPoints: number;
	compactions: number;
	labels: number;
	isForked: boolean;
	userMessages: string[];
	assistantSnippets: string[];
	toolCalls: Array<{ tool: string; path?: string }>;
	filesRead: string[];
	filesEdited: string[];
}

export interface SavedCoachReport {
	markdown: string;
	scope: CoachScope;
	createdAt: string;
}
