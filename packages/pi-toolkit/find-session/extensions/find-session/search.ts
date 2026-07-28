/**
 * pi-toolkit-find-session — search
 *
 * The only I/O module. Runs `rg --json` across `~/.pi/agent/sessions/`,
 * groups matches by file, and returns the top N. Falls back to a
 * `fs.readdir` + per-file `readFile` walk when rg is unavailable.
 *
 * Why rg-only (not fd-then-rg): rg's `-g '*.jsonl'` glob does file
 * discovery and content search in one pass. Adding fd would be a
 * second subprocess for no gain.
 *
 * Why execFile args (not shell): the family rule is no `shell: true`,
 * ever. Model- or user-provided patterns cannot become CLI flags.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RgMatchLine, SessionMatch } from "./types";

const RG_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 50;
const MAX_PREVIEW = 200;
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

interface RgExecResult {
	code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
}

/**
 * Run rg --json across `~/.pi/agent/sessions/`, group matches by file,
 * return top N.
 *
 * Throws on rg timeout (killed). On rg exit 1 with no output, returns [].
 * On rg exit 2 (real error) or rg missing, falls back to the
 * `fs.readdir` + `readFile` walk.
 */
export async function searchSessions(
	pi: ExtensionAPI,
	query: string,
	signal?: AbortSignal,
): Promise<SessionMatch[]> {
	return searchSessionsIn(pi, query, SESSIONS_DIR, signal);
}

/**
 * Lower-level search that takes an explicit directory. Tests use this
 * with a `mkdtempSync` directory; production callers use the wrapper
 * `searchSessions` which uses `SESSIONS_DIR`.
 */
export async function searchSessionsIn(
	pi: ExtensionAPI,
	query: string,
	dir: string,
	signal?: AbortSignal,
): Promise<SessionMatch[]> {
	const rgArgs = [
		"-i",
		"-F",
		"--json",
		"--max-columns=200",
		"-g",
		"*.jsonl",
		query,
		dir,
	];

	let result: RgExecResult;
	try {
		result = await pi.exec("rg", rgArgs, { signal, timeout: RG_TIMEOUT_MS });
	} catch {
		// rg missing or otherwise failed to spawn
		return searchSessionsFallbackIn(query, dir, signal);
	}

	if (result.killed) {
		throw new Error(`rg search timed out after ${RG_TIMEOUT_MS}ms`);
	}

	// rg exit 1: no matches — distinct from error
	if (result.code === 1) return [];

	// rg exit 2: real error — try the fs fallback rather than hard-fail
	if (result.code !== 0) {
		return searchSessionsFallbackIn(query, dir, signal);
	}

	const matches: RgMatchLine[] = [];
	for (const line of result.stdout.split("\n")) {
		if (!line) continue;
		const parsed = parseRgJsonLine(line);
		if (parsed) matches.push(parsed);
	}

	return groupByFile(matches).slice(0, MAX_RESULTS);
}

/**
 * Parse one line of `rg --json` output. Returns null for non-match
 * events (`begin`, `end`, `summary`) and malformed JSON.
 */
export function parseRgJsonLine(line: string): RgMatchLine | null {
	let event: {
		type?: string;
		data?: {
			path?: { text?: string };
			line_number?: number;
			lines?: { text?: string };
		};
	};
	try {
		event = JSON.parse(line);
	} catch {
		return null;
	}
	if (event.type !== "match") return null;
	const data = event.data;
	const path = data?.path?.text;
	const lineNumber = data?.line_number;
	const matchedText = data?.lines?.text;
	if (typeof path !== "string" || typeof lineNumber !== "number" || typeof matchedText !== "string") {
		return null;
	}
	return {
		filePath: path,
		lineNumber,
		matchedText:
			matchedText.length > MAX_PREVIEW
				? `${matchedText.slice(0, MAX_PREVIEW - 1)}…`
				: matchedText,
		projectLabel: projectLabelFor(path),
	};
}

/**
 * Group RgMatchLines by filePath. Keeps the first match as the preview,
 * counts the rest, and sorts by match count descending (most matches
 * per file first).
 */
export function groupByFile(matches: RgMatchLine[]): SessionMatch[] {
	const byFile = new Map<string, { first: RgMatchLine; count: number }>();
	for (const match of matches) {
		const existing = byFile.get(match.filePath);
		if (existing) {
			existing.count += 1;
		} else {
			byFile.set(match.filePath, { first: match, count: 1 });
		}
	}
	const grouped: SessionMatch[] = [];
	for (const [filePath, { first, count }] of byFile) {
		grouped.push({
			filePath,
			projectLabel: first.projectLabel,
			firstMatch: first,
			matchCount: count,
		});
	}
	grouped.sort((a, b) => {
		if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
		return a.filePath.localeCompare(b.filePath);
	});
	return grouped;
}

/**
 * Walk `~/.pi/agent/sessions/` recursively, read each `.jsonl`,
 * substring-match the query. Used when rg is missing or fails. Slower
 * but always works.
 */
export async function searchSessionsFallback(
	_pi: ExtensionAPI,
	query: string,
	signal?: AbortSignal,
): Promise<SessionMatch[]> {
	return searchSessionsFallbackIn(query, SESSIONS_DIR, signal);
}

/**
 * Lower-level fallback with an explicit directory. Tests use this
 * with a `mkdtempSync` directory.
 */
export async function searchSessionsFallbackIn(
	query: string,
	dir: string,
	signal?: AbortSignal,
): Promise<SessionMatch[]> {
	if (signal?.aborted) return [];
	if (!existsSync(dir)) return [];

	const files = await walkJsonl(dir, signal);
	if (files.length === 0) return [];

	const needle = query.toLowerCase();
	const matches: RgMatchLine[] = [];

	for (const filePath of files) {
		if (signal?.aborted) return [];
		let content: string;
		try {
			content = await readFile(filePath, "utf8");
		} catch {
			continue;
		}
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line.toLowerCase().includes(needle)) continue;
			matches.push({
				filePath,
				lineNumber: i + 1,
				matchedText:
					line.length > MAX_PREVIEW ? `${line.slice(0, MAX_PREVIEW - 1)}…` : line,
				projectLabel: projectLabelFor(filePath),
			});
			// Don't bother counting every match per file in the fallback —
			// the spec caps at 50 anyway. Break to keep this O(n) per file.
			break;
		}
	}

	return groupByFile(matches).slice(0, MAX_RESULTS);
}

async function walkJsonl(root: string, signal?: AbortSignal): Promise<string[]> {
	const out: string[] = [];
	const queue: string[] = [root];
	while (queue.length > 0) {
		if (signal?.aborted) return out;
		const dir = queue.shift();
		if (!dir) break;
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				queue.push(full);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				out.push(full);
			}
		}
	}
	return out;
}

/**
 * Best-effort project label from a session file path. A session file
 * lives somewhere like `~/.pi/agent/sessions/<project-hash>/<date>-<uuid>.jsonl`
 * or `~/.pi/agent/sessions/<date>-<uuid>.jsonl`. We use the parent
 * directory's basename, or fall back to the file's basename minus the
 * extension.
 */
function projectLabelFor(filePath: string): string {
	const parent = basename(dirname(filePath));
	if (parent && parent !== "." && parent !== sep) return parent;
	const file = basename(filePath, ".jsonl");
	return file;
}

export const __testing = {
	RG_TIMEOUT_MS,
	MAX_RESULTS,
	MAX_PREVIEW,
	SESSIONS_DIR,
	projectLabelFor,
	walkJsonl,
};
