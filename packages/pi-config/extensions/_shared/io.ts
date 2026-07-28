/**
 * Atomic file I/O primitives.
 *
 * Every state file in pi-config goes through these helpers. Writes are
 * POSIX-atomic via temp-file + rename, and corrupt reads are quarantined
 * to `<path>.corrupt-<timestamp>` rather than silently overwritten or
 * thrown away.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Base64url-encode a session id so it can be a directory name. */
export function encodeSessionId(sessionId: string): string {
	if (!sessionId) {
		throw new Error("Cannot encode an empty session id.");
	}
	return Buffer.from(sessionId, "utf8").toString("base64url");
}

/** Read a JSON file, returning `empty` on missing or corrupt input. */
export function readStateOrEmpty<T>(path: string, empty: T): T {
	if (!existsSync(path)) return empty;
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		quarantineCorrupt(path);
		return empty;
	}
}

/**
 * Quarantine a corrupt file. Best-effort: if the rename fails (e.g. on
 * read-only filesystems), the next read will simply re-attempt the move.
 */
export function quarantineCorrupt(path: string): void {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	try {
		renameSync(path, `${path}.corrupt-${stamp}`);
	} catch {
		// best-effort
	}
}

/**
 * Write a JSON file atomically: temp file in the same directory, then
 * rename. POSIX rename within a directory is atomic, so concurrent readers
 * always see the old or new content — never a partial write.
 */
export function writeStateAtomic(path: string, state: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(state, null, "\t") + "\n");
	renameSync(tmp, path);
}
