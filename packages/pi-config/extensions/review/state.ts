/**
 * review/state.ts
 *
 * Session-scoped persistent state for the review extension.
 *
 * Storage layout (per principle 3):
 *   ~/.pi/agent/pi-config/review/<base64url(sessionId)>/state.json
 *
 * Writes are serialized through `withFileMutationQueue`; lifecycle
 * transitions (start, status change, finish) persist eagerly. High-
 * frequency activity updates (last-tool name, count) coalesce to 1s
 * via the in-memory `schedulePersist` helper.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { ReviewStateSchema } from "./schemas";
import type { ReviewRecord, ReviewState } from "./types";

const ACTIVITY_DEBOUNCE_MS = 1_000;

function encodeSessionId(sessionId: string): string {
	if (!sessionId) throw new Error("Session id is required for review state.");
	return Buffer.from(sessionId, "utf8").toString("base64url");
}

function sessionDir(sessionId: string): string {
	return join(getAgentDir(), "pi-config", "review", encodeSessionId(sessionId));
}

function statePath(sessionId: string): string {
	return join(sessionDir(sessionId), "state.json");
}

function readStateSync(sessionId: string): ReviewState {
	const path = statePath(sessionId);
	if (!existsSync(path)) return { current: null };
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof raw !== "object" || raw === null) return { current: null };
		if (!Value.Check(ReviewStateSchema, raw)) return { current: null };
		return raw as ReviewState;
	} catch {
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			renameSync(path, `${path}.corrupt-${stamp}`);
		} catch {
			// best effort
		}
		return { current: null };
	}
}

function writeStateSync(sessionId: string, state: ReviewState): void {
	const path = statePath(sessionId);
	mkdirSync(sessionDir(sessionId), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(state, null, "\t") + "\n");
	renameSync(tmp, path);
}

export async function mutateState(
	sessionId: string,
	transform: (current: ReviewState) => ReviewState | undefined,
): Promise<ReviewState> {
	const path = statePath(sessionId);
	return withFileMutationQueue(path, async () => {
		const current = readStateSync(sessionId);
		const next = transform(current);
		if (!next) return current;
		writeStateSync(sessionId, next);
		return next;
	});
}

export function readState(sessionId: string): ReviewState {
	return readStateSync(sessionId);
}

/**
 * Per-session state container. Tracks the current review record and
 * schedules debounced writes for high-frequency activity updates while
 * persisting lifecycle transitions eagerly.
 */
export class ReviewStore {
	private record: ReviewRecord | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private dirtyActivity = false;
	private readonly sessionId: string;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
		const initial = readStateSync(sessionId);
		this.record = initial.current;
	}

	get(): ReviewRecord | null {
		return this.record;
	}

	/** Eagerly persist a lifecycle transition (start, status, finish). */
	async transition(next: ReviewRecord | null): Promise<void> {
		this.record = next;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.dirtyActivity = false;
		await this.flush();
	}

	/** Mark a high-frequency activity change. Persists within 1s. */
	activity(patch: Partial<ReviewRecord>): void {
		if (!this.record) return;
		Object.assign(this.record, patch);
		this.record.updatedAt = Date.now();
		this.dirtyActivity = true;
		if (this.debounceTimer) return;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			if (!this.dirtyActivity) return;
			this.dirtyActivity = false;
			void this.flush();
		}, ACTIVITY_DEBOUNCE_MS);
	}

	private async flush(): Promise<void> {
		await mutateState(this.sessionId, () => ({ current: this.record }));
	}
}
