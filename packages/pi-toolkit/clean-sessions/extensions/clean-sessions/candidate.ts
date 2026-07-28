/**
 * pi-toolkit-clean-sessions — candidate
 *
 * Core scanning logic: walk the sessions directory, read each .jsonl,
 * count lines, extract the session name, and apply age + line-count
 * + auto-name filters.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { countLines, createLineReader } from "./io";
import { shouldExempt } from "./scoring";
import type { SessionCandidate } from "./types";

// ============================================================================
// Constants
// ============================================================================

export const SESSIONS_DIR = path.join(homedir(), ".pi", "agent", "sessions");
export const TRASH_DIR = path.join(SESSIONS_DIR, ".trash");
export const MIN_LINES = 12;
export const DEFAULT_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Filename parsing
// ============================================================================

/**
 * Parse the session start date from a Pi auto-generated filename.
 *
 * Expected format: `2026-01-15T12-30-45-123Z_<uuid>.jsonl`
 * Returns null if the filename doesn't match.
 */
function parseSessionStartFromFilename(name: string): Date | null {
	const match = name.match(
		/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/,
	);
	if (!match) return null;

	const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
	const parsed = new Date(iso);
	return Number.isFinite(parsed.getTime()) ? parsed : null;
}

// ============================================================================
// Path safety
// ============================================================================

// ============================================================================
// Directory walking
// ============================================================================

/**
 * Recursively walk a directory for .jsonl files, skipping resolved dirs.
 */
async function walkJsonlFiles(
	root: string,
	skipResolvedDirs?: Set<string>,
): Promise<string[]> {
	const out: string[] = [];
	const stack: string[] = [root];
	const skipDirs = skipResolvedDirs ?? new Set<string>();

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
				if (skipDirs.has(path.resolve(entryPath))) continue;
				stack.push(entryPath);
				continue;
			}

			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				out.push(entryPath);
			}
		}
	}

	return out;
}

// ============================================================================
// Session name extraction
// ============================================================================

/**
 * Extract the session name from a JSONL file's session_info header line.
 * Streams through the file and stops at the first session_info line.
 */
async function extractSessionName(filePath: string): Promise<string | null> {
	const { reader, stream } = createLineReader(filePath);
	let name: string | null = null;

	try {
		for await (const line of reader) {
			if (!line) continue;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}

			if (
				parsed !== null &&
				typeof parsed === "object" &&
				"type" in parsed &&
				(parsed as Record<string, unknown>).type === "session_info" &&
				typeof (parsed as Record<string, unknown>).name === "string"
			) {
				const rawName = (parsed as Record<string, unknown>).name as string;
				name = rawName.trim() || null;
				break;
			}
		}
	} finally {
		reader.close();
		stream.destroy();
	}

	return name;
}

// ============================================================================
// findCandidates
// ============================================================================

export interface FindCandidatesOptions {
	/** Sessions older than this many days. */
	olderThanDays: number;
	/** Files with fewer lines than this are candidates. Default: MIN_LINES. */
	minLines?: number;
}

export interface FindCandidatesInOptions extends FindCandidatesOptions {
	/** Explicit sessions directory (for testing). */
	sessionsDir: string;
	/** Explicit trash directory to skip (for testing). */
	trashDir: string;
}

/**
 * Scan a sessions directory for cleanup candidates.
 *
 * Tests use this with temp directories. Production callers use the wrapper
 * `findCandidates` which supplies the real SESSIONS_DIR and TRASH_DIR.
 */
export async function findCandidatesIn(
	options: FindCandidatesInOptions,
): Promise<SessionCandidate[]> {
	const {
		olderThanDays,
		minLines = MIN_LINES,
		sessionsDir,
		trashDir,
	} = options;
	const now = new Date();
	const cutoffMs = now.getTime() - olderThanDays * DAY_IN_MS;
	const resolvedSessionsDir = path.resolve(sessionsDir);

	function isInsideRoot(filePath: string): boolean {
		const resolved = path.resolve(filePath);
		return (
			resolved === resolvedSessionsDir ||
			resolved.startsWith(`${resolvedSessionsDir}${path.sep}`)
		);
	}

	const resolvedTrash = path.resolve(trashDir);
	const allFiles = await walkJsonlFiles(sessionsDir, new Set([resolvedTrash]));

	const candidates: SessionCandidate[] = [];

	for (const filePath of allFiles) {
		// Path-verified: reject anything outside sessionsDir (symlink defense).
		if (!isInsideRoot(filePath)) continue;

		const fileName = path.basename(filePath);
		const startedAt = parseSessionStartFromFilename(fileName);

		// Files without a parseable timestamp prefix are not auto-sessions.
		if (!startedAt) continue;

		// Age filter.
		if (startedAt.getTime() > cutoffMs) continue;

		// Line-count filter.
		const lineCount = await countLines(filePath);
		if (lineCount >= minLines) continue;

		// Name extraction + exemption filter.
		const name = await extractSessionName(filePath);

		const candidate: SessionCandidate = {
			path: filePath,
			mtimeMs: startedAt.getTime(),
			sizeBytes: 0,
			lineCount,
			name,
			ageDays: Math.floor(
				(now.getTime() - startedAt.getTime()) / DAY_IN_MS,
			),
		};

		if (shouldExempt(candidate)) continue;

		candidates.push(candidate);
	}

	// Sort oldest-first.
	candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
	return candidates;
}

/**
 * Scan the real sessions directory for cleanup candidates.
 *
 * A session is a candidate when ALL of these hold:
 *   1. Filename has a parseable date AND the date is older than olderThanDays
 *   2. Fewer than minLines lines (default 12)
 *   3. Auto-named or unnamed (manually-named sessions are always exempt)
 */
export async function findCandidates(
	options: FindCandidatesOptions,
): Promise<SessionCandidate[]> {
	return findCandidatesIn({
		...options,
		sessionsDir: SESSIONS_DIR,
		trashDir: TRASH_DIR,
	});
}
