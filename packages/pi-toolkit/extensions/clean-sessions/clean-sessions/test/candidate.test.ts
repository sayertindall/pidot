/**
 * candidate.test.ts
 *
 * Integration tests for findCandidatesIn using temporary directories.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCandidatesIn } from '../candidate';

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "clean-sessions-cand-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

/** Create a fake session .jsonl file with a date-based filename. */
function writeSession(
	name: string,
	lineCount: number,
	options?: {
		sessionName?: string | null;
		dateOffsetDays?: number;
	},
): string {
	const dateStr = dateString(options?.dateOffsetDays ?? 45);
	const filePath = join(tmp, `${dateStr}_${name}.jsonl`);
	const lines: string[] = [];
	if (options?.sessionName !== undefined) {
		if (options.sessionName !== null) {
			lines.push(
				JSON.stringify({ type: "session_info", name: options.sessionName }),
			);
		}
		// Fill remaining lines.
		for (let i = lines.length; i < lineCount; i++) {
			lines.push(JSON.stringify({ type: "message", text: `line ${i}` }));
		}
	} else {
		for (let i = 0; i < lineCount; i++) {
			lines.push(JSON.stringify({ type: "message", text: `line ${i}` }));
		}
	}
	writeFileSync(filePath, lines.join("\n") + "\n");
	return filePath;
}

/** Generate a date string offset by N days from now. */
function dateString(offsetDays: number): string {
	const d = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const min = String(d.getUTCMinutes()).padStart(2, "0");
	const ss = String(d.getUTCSeconds()).padStart(2, "0");
	const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
	return `${yyyy}-${mm}-${dd}T${hh}-${min}-${ss}-${ms}Z`;
}

describe("findCandidatesIn", () => {
	it("returns empty array when no sessions exist", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toEqual([]);
	});

	it("returns empty array when all sessions are too new", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		// Session is only 5 days old, but filter requires >30 days.
		writeSession("recent", 5, { dateOffsetDays: 5 });

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toEqual([]);
	});

	it("returns empty array when all sessions have too many lines", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		// 50 lines, but threshold is 12.
		writeSession("long", 50, { dateOffsetDays: 60 });

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toEqual([]);
	});

	it("returns empty array when session has a manual name", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		writeSession("manual", 3, {
			dateOffsetDays: 60,
			sessionName: "my important debug session",
		});

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toEqual([]);
	});

	it("returns candidates that are old, short, and auto-named", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		const p1 = writeSession("c1", 3, {
			dateOffsetDays: 60,
			sessionName: "2026-01-15 some auto name",
		});
		const p2 = writeSession("c2", 5, {
			dateOffsetDays: 90,
			sessionName: null,
		});

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toHaveLength(2);

		const paths = result.map((c) => c.path).sort();
		expect(paths).toEqual([p1, p2].sort());
	});

	it("excludes files that don't match the date filename pattern", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		// This file doesn't have the YYYY-MM-DDThh-mm-ss-msZ_ prefix.
		const filePath = join(tmp, "not-a-session.jsonl");
		writeFileSync(filePath, '{"type":"message","text":"hello"}\n');

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toEqual([]);
	});

	it("sorts candidates oldest-first", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		// Older session.
		writeSession("old", 3, { dateOffsetDays: 100, sessionName: null });
		// Newer session.
		writeSession("new", 3, { dateOffsetDays: 50, sessionName: null });

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toHaveLength(2);

		// Oldest first.
		expect(result[0]!.ageDays).toBeGreaterThanOrEqual(result[1]!.ageDays);
	});

	it("respects custom minLines", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		writeSession("s1", 25, { dateOffsetDays: 60, sessionName: null });
		writeSession("s2", 30, { dateOffsetDays: 60, sessionName: null });

		// Default minLines = 12: neither qualifies (both > 12).
		const resultDefault = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(resultDefault).toHaveLength(0);

		// Custom minLines = 50: both qualify.
		const resultCustom = await findCandidatesIn({
			olderThanDays: 30,
			minLines: 50,
			sessionsDir: tmp,
			trashDir,
		});
		expect(resultCustom).toHaveLength(2);
	});

	it("skips .trash directory during walk", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		// Session in the trash dir (should be skipped).
		writeFileSync(
			join(trashDir, "2025-01-01T00-00-00-000Z_trashed.jsonl"),
			'{"type":"message","text":"trash"}\n',
		);

		// Real session (should be found).
		const realPath = writeSession("real", 3, {
			dateOffsetDays: 60,
			sessionName: null,
		});

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toHaveLength(1);
		expect(result[0]!.path).toBe(realPath);
	});

	it("preserves subdirectory structure in candidate paths", async () => {
		const trashDir = join(tmp, ".trash");
		mkdirSync(trashDir, { recursive: true });

		const subDir = join(tmp, "project-hash-123");
		mkdirSync(subDir, { recursive: true });

		const dateStr = dateString(60);
		const filePath = join(subDir, `${dateStr}_session.jsonl`);
		writeFileSync(filePath, '{"type":"message","text":"sub"}\n');

		const result = await findCandidatesIn({
			olderThanDays: 30,
			sessionsDir: tmp,
			trashDir,
		});
		expect(result).toHaveLength(1);
		expect(result[0]!.path).toBe(filePath);
	});
});
