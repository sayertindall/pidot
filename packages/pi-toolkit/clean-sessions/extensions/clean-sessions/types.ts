/**
 * pi-toolkit-clean-sessions — types
 *
 * Pure type definitions. No runtime, no side effects.
 */

/** A session file that qualifies for cleanup. */
export interface SessionCandidate {
	/** Absolute path to the .jsonl file. */
	path: string;
	/** Last-modified timestamp (ms since epoch). */
	mtimeMs: number;
	/** File size in bytes. */
	sizeBytes: number;
	/** Number of JSONL lines in the file. */
	lineCount: number;
	/** Session name from the session_info header, or null if unnamed. */
	name: string | null;
	/** Age of the session in days (computed during scan). */
	ageDays: number;
}

/** Result of a cleanup (move-to-trash) operation. */
export interface CleanupResult {
	/** Number of files successfully moved. */
	movedCount: number;
	/** Number of files that failed to move. */
	failedCount: number;
	/** Name of the trash subdirectory (ISO timestamp). */
	trashSubdir: string;
}

/** Result of listing the trash directory. */
export interface TrashList {
	/** Timestamp subdirectory names under .trash/. */
	subdirs: string[];
	/** Total size in bytes of all trashed files. */
	totalSize: number;
}

/** Result of emptying the trash. */
export interface EmptyTrashResult {
	/** Number of files permanently deleted. */
	removedCount: number;
	/** Total bytes freed. */
	bytesFreed: number;
}
