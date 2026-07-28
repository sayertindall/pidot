/**
 * pi-toolkit-clean-sessions — trash
 *
 * Filesystem operations for the .trash/ directory: move files in, list
 * trashed content, and permanently delete.
 *
 * The .trash/ directory preserves the original sessions subdirectory
 * structure so files can be restored by moving them back.
 *
 * Each cleanup run creates a timestamped subdirectory:
 *   .trash/<ISO-timestamp>/<relative-path>.jsonl
 *
 * A MOVE-LOG.json is written to:
 *   ~/.pi/agent/pi-toolkit/clean-sessions/log/<timestamp>.json
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SESSIONS_DIR, TRASH_DIR } from "./candidate";
import type {
	CleanupResult,
	EmptyTrashResult,
	SessionCandidate,
	TrashList,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const LOG_DIR = path.join(
	homedir(),
	".pi",
	"agent",
	"pi-toolkit",
	"clean-sessions",
	"log",
);

// ============================================================================
// Path safety helpers
// ============================================================================

function isInsideRoot(filePath: string, rootPath: string): boolean {
	const resolved = path.resolve(filePath);
	const resolvedRoot = path.resolve(rootPath);
	return (
		resolved === resolvedRoot ||
		resolved.startsWith(`${resolvedRoot}${path.sep}`)
	);
}

async function dirExists(dirPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dirPath);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

// ============================================================================
// moveToTrash
// ============================================================================

export interface MoveToTrashInOptions {
	candidates: SessionCandidate[];
	sessionsDir: string;
	trashDir: string;
	signal?: AbortSignal;
}

/**
 * Testable variant of moveToTrash with explicit directory paths.
 */
export async function moveToTrashIn(
	options: MoveToTrashInOptions,
): Promise<CleanupResult> {
	const { candidates, sessionsDir, trashDir, signal } = options;

	// Generate a unique timestamp-based subdirectory name.
	// We retry with an incrementing suffix if the directory already exists
	// (e.g., two cleanup runs in the same second).
	let timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	let trashSubdir = path.join(trashDir, timestamp);
	let suffix = 1;
	while (await dirExists(trashSubdir)) {
		suffix++;
		timestamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${suffix}`;
		trashSubdir = path.join(trashDir, timestamp);
	}

	let movedCount = 0;
	let failedCount = 0;

	const logEntries: Array<{
		from: string;
		to: string;
		name: string | null;
		lineCount: number;
	}> = [];

	await fs.mkdir(trashSubdir, { recursive: true });

	for (const candidate of candidates) {
		if (signal?.aborted) break;

		// Safety: only operate inside sessionsDir.
		if (!isInsideRoot(candidate.path, sessionsDir)) {
			failedCount++;
			continue;
		}

		// Safety: only move .jsonl files.
		if (!candidate.path.endsWith(".jsonl")) {
			failedCount++;
			continue;
		}

		const relativePath = path.relative(sessionsDir, candidate.path);
		const dest = path.join(trashSubdir, relativePath);

		try {
			await fs.mkdir(path.dirname(dest), { recursive: true });

			// Try rename first (same-device, fast).
			try {
				await fs.rename(candidate.path, dest);
			} catch {
				// Cross-device fallback: copy then unlink.
				await fs.copyFile(candidate.path, dest);
				await fs.unlink(candidate.path);
			}

			logEntries.push({
				from: candidate.path,
				to: dest,
				name: candidate.name,
				lineCount: candidate.lineCount,
			});

			movedCount++;
		} catch {
			failedCount++;
		}
	}

	// Write MOVE-LOG.json.
	if (logEntries.length > 0) {
		await fs.mkdir(LOG_DIR, { recursive: true });
		await fs.writeFile(
			path.join(LOG_DIR, `${timestamp}.json`),
			JSON.stringify(
				{
					timestamp,
					movedAt: new Date().toISOString(),
					count: logEntries.length,
					files: logEntries,
				},
				null,
				2,
			),
			"utf8",
		);
	}

	return { movedCount, failedCount, trashSubdir: timestamp };
}

/**
 * Move candidate session files into the trash directory (production).
 */
export async function moveToTrash(
	candidates: SessionCandidate[],
	signal?: AbortSignal,
): Promise<CleanupResult> {
	return moveToTrashIn({
		candidates,
		sessionsDir: SESSIONS_DIR,
		trashDir: TRASH_DIR,
		signal,
	});
}

// ============================================================================
// listTrash
// ============================================================================

/**
 * Testable variant with explicit trash directory.
 */
export async function listTrashIn(trashDir: string): Promise<TrashList> {
	const subdirs: string[] = [];
	let totalSize = 0;

	let topEntries;
	try {
		topEntries = await fs.readdir(trashDir, { withFileTypes: true });
	} catch {
		return { subdirs, totalSize };
	}

	for (const entry of topEntries) {
		if (!entry.isDirectory()) continue;

		const subdir = path.join(trashDir, entry.name);

		const files = await walkJsonlFiles(subdir);
		if (files.length > 0) {
			subdirs.push(entry.name);

			for (const file of files) {
				try {
					const stat = await fs.stat(file);
					totalSize += stat.size;
				} catch {
					// File might have been removed since listing.
				}
			}
		}
	}

	return { subdirs, totalSize };
}

/**
 * List the contents of the trash directory (production).
 */
export async function listTrash(): Promise<TrashList> {
	return listTrashIn(TRASH_DIR);
}

// ============================================================================
// emptyTrash
// ============================================================================

export interface EmptyTrashInOptions {
	trashDir: string;
	/** Specific timestamp subdirectory to empty. Omit to empty all. */
	subdir?: string;
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

/**
 * Testable variant with explicit trash directory.
 */
export async function emptyTrashIn(
	options: EmptyTrashInOptions,
): Promise<EmptyTrashResult> {
	const { trashDir, subdir: targetSubdir, signal } = options;

	let removedCount = 0;
	let bytesFreed = 0;

	const dirsToProcess: string[] = [];

	if (targetSubdir) {
		dirsToProcess.push(path.join(trashDir, targetSubdir));
	} else {
		try {
			const entries = await fs.readdir(trashDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				dirsToProcess.push(path.join(trashDir, entry.name));
			}
		} catch {
			return { removedCount, bytesFreed };
		}
	}

	for (const dir of dirsToProcess) {
		if (signal?.aborted) break;

		const files = await walkJsonlFiles(dir);

		for (const filePath of files) {
			if (signal?.aborted) break;

			if (!isInsideRoot(filePath, trashDir)) continue;

			try {
				const stat = await fs.stat(filePath);
				bytesFreed += stat.size;
			} catch {
				// File might have been removed.
			}

			try {
				await fs.unlink(filePath);
				removedCount++;
			} catch {
				// Best-effort.
			}
		}

		// Remove the empty directory tree.
		try {
			await removeEmptyDirs(dir);
		} catch {
			// Best-effort.
		}
	}

	return { removedCount, bytesFreed };
}

/**
 * Permanently delete trashed session files (production).
 */
export async function emptyTrash(
	options: { subdir?: string; signal?: AbortSignal } = {},
): Promise<EmptyTrashResult> {
	return emptyTrashIn({ ...options, trashDir: TRASH_DIR });
}

// ============================================================================
// Internal helpers
// ============================================================================

async function walkJsonlFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const stack: string[] = [root];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;

		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const entryPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				out.push(entryPath);
			}
		}
	}

	return out;
}

async function removeEmptyDirs(dir: string): Promise<void> {
	const entries = await fs.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const subdir = path.join(dir, entry.name);
		await removeEmptyDirs(subdir);

		try {
			await fs.rmdir(subdir);
		} catch {
			// Directory still contains files.
		}
	}

	// Also try to remove the top-level dir itself.
	try {
		await fs.rmdir(dir);
	} catch {
		// Still contains something.
	}
}
