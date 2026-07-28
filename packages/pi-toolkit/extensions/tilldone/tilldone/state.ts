/**
 * pi-toolkit-tilldone — state
 *
 * JSON state persisted to disk with atomic write (temp file + renameSync).
 * Session-scoped: ~/.pi/agent/pi-toolkit/tilldone/<sessionId>/state.json
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { defaultState } from "./schemas";
import type { TillDoneState } from "./types";

/** Return the state directory (computed lazily). */
function getStateDir(): string {
	return join(homedir(), ".pi", "agent", "pi-toolkit", "tilldone");
}

/** Return the state file path for a given session ID. */
export function statePath(sessionId: string): string {
	return join(getStateDir(), sessionId, "state.json");
}

/** Read state from disk. Returns default state if file missing or corrupt. */
export function readStateOrEmpty(sessionId: string): TillDoneState {
	const path = statePath(sessionId);

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return defaultState();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Corruption: move the bad file and return empty.
		moveCorrupt(path);
		return defaultState();
	}

	if (isValidState(parsed)) {
		return parsed as TillDoneState;
	}

	// Valid JSON but doesn't match schema.
	moveCorrupt(path);
	return defaultState();
}

/**
 * Atomically write state to disk.
 * Writes to a temp file, then `renameSync` for atomicity.
 */
export function writeStateAtomic(path: string, state: TillDoneState): void {
	mkdirSync(dirname(path), { recursive: true });

	const tmp = path + ".tmp." + Date.now();
	try {
		writeFileSync(tmp, JSON.stringify(state, null, "\t"), "utf8");
		renameSync(tmp, path);
	} catch (err) {
		// Best-effort cleanup of temp file.
		try {
			const { unlinkSync } = require("node:fs") as typeof import("node:fs");
			unlinkSync(tmp);
		} catch {
			// ignore
		}
		throw err;
	}
}

// -- Mutation queue ---------------------------------------------------------

/**
 * Serialise mutations to a given state file via the runtime's per-file
 * queue. Reads current state, applies `transform`, and writes back —
 * unless `transform` returns `undefined`, in which case the file is left
 * untouched.
 *
 * Read-only callers must use `readStateOrEmpty` directly: an identity
 * transform `(s) => s` returns a non-undefined value and would trigger an
 * unnecessary write on every call.
 */
export async function mutateState(
	sessionId: string,
	transform: (current: TillDoneState) => TillDoneState | undefined,
): Promise<TillDoneState> {
	const path = statePath(sessionId);
	return withFileMutationQueue(path, async () => {
		const current = readStateOrEmpty(sessionId);
		const updated = transform(current);
		if (updated !== undefined) {
			writeStateAtomic(path, updated);
			return updated;
		}
		return current;
	});
}

// -- Helpers ----------------------------------------------------------------

/** Validate that parsed JSON matches the TillDoneState shape. */
function isValidState(value: unknown): value is TillDoneState {
	if (value === null || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.enabled !== "boolean") return false;
	if (!Array.isArray(v.tasks)) return false;
	if (typeof v.nextId !== "number") return false;
	for (const t of v.tasks) {
		if (t === null || typeof t !== "object") return false;
		const task = t as Record<string, unknown>;
		if (typeof task.id !== "number") return false;
		if (typeof task.text !== "string") return false;
		if (task.status !== "idle" && task.status !== "inprogress" && task.status !== "done") return false;
		if (task.gate !== undefined && typeof task.gate !== "string") return false;
	}
	return true;
}

function moveCorrupt(path: string): void {
	try {
		const ts = Date.now();
		renameSync(path, path + ".corrupt-" + ts);
	} catch {
		// If we can't even rename, just leave it.
	}
}
