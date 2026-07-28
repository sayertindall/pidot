/**
 * review/types.ts
 *
 * Code review in a fresh session branch. Lifecycle:
 *   idle → launching → running → done | failed | cancelled
 *
 * Persistent state (session-scoped, base64url session id):
 *   ~/.pi/agent/pi-config/review/<base64url(sessionId)>/state.json
 *
 * In-memory state holds the review record + the cancellation signal so
 * the widget can render an updated elapsed-time line.
 */

export type ReviewStatus = "idle" | "launching" | "running" | "done" | "failed" | "cancelled";

export type ReviewTargetKind = "uncommitted" | "baseBranch" | "commit" | "pullRequest";

export type ReviewTarget =
	| { type: "uncommitted" }
	| { type: "baseBranch"; branch: string }
	| { type: "commit"; sha: string; title?: string }
	| { type: "pullRequest"; prNumber: number; baseBranch: string; title: string };

export type ReviewRecord = {
	target: ReviewTarget;
	status: ReviewStatus;
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
	lastActivityAt?: number;
	lastToolName?: string;
	toolCount: number;
	filesChanged?: number;
	result?: string;
	error?: string;
};

export type ReviewState = {
	current: ReviewRecord | null;
};
