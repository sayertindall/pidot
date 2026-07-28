/**
 * trash.test.ts
 *
 * Integration tests for moveToTrashIn, listTrashIn, and emptyTrashIn
 * using temporary directories.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveToTrashIn, listTrashIn, emptyTrashIn } from '../trash';
import type { SessionCandidate } from '../types';

let sessionsDir: string;
let trashDir: string;

beforeEach(() => {
	const tmp = mkdtempSync(join(tmpdir(), "clean-sessions-trash-"));
	sessionsDir = join(tmp, "sessions");
	trashDir = join(tmp, "sessions", ".trash");
	mkdirSync(trashDir, { recursive: true });
});

afterEach(() => {
	// Remove the parent temp directory.
	const parent = join(sessionsDir, "..");
	rmSync(parent, { recursive: true, force: true });
});

function writeSessionFile(relPath: string, content: string): string {
	const fullPath = join(sessionsDir, relPath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

function makeCandidate(
	filePath: string,
	lineCount = 5,
	name: string | null = null,
): SessionCandidate {
	return {
		path: filePath,
		mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
		sizeBytes: 100,
		lineCount,
		name,
		ageDays: 60,
	};
}

describe("moveToTrashIn", () => {
	it("moves files to a timestamped subdirectory preserving structure", async () => {
		const filePath = writeSessionFile(
			"project-hash/session.jsonl",
			'{"type":"message","text":"hello"}\n',
		);
		const candidate = makeCandidate(filePath);

		const result = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});

		expect(result.movedCount).toBe(1);
		expect(result.failedCount).toBe(0);
		expect(result.trashSubdir).toBeTruthy();

		// Original file should be gone.
		expect(existsSync(filePath)).toBe(false);

		// File should exist under trash/<timestamp>/project-hash/session.jsonl.
		const trashPath = join(trashDir, result.trashSubdir, "project-hash", "session.jsonl");
		expect(existsSync(trashPath)).toBe(true);
	});

	it("rejects files outside sessionsDir", async () => {
		const outsidePath = join(tmpdir(), "outside.jsonl");
		writeFileSync(outsidePath, '{"type":"message","text":"evil"}\n');
		const candidate = makeCandidate(outsidePath);

		const result = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});

		expect(result.movedCount).toBe(0);
		expect(result.failedCount).toBe(1);

		// Cleanup.
		rmSync(outsidePath, { force: true });
	});

	it("rejects non-.jsonl files", async () => {
		const filePath = join(sessionsDir, "notes.txt");
		writeFileSync(filePath, "hello");
		const candidate: SessionCandidate = {
			path: filePath,
			mtimeMs: Date.now(),
			sizeBytes: 10,
			lineCount: 1,
			name: null,
			ageDays: 45,
		};

		const result = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});

		expect(result.movedCount).toBe(0);
		expect(result.failedCount).toBe(1);
	});

	it("handles failures gracefully", async () => {
		// Candidate pointing to a non-existent file.
		const candidate = makeCandidate(
			join(sessionsDir, "does-not-exist.jsonl"),
		);

		const result = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});

		expect(result.movedCount).toBe(0);
		expect(result.failedCount).toBe(1);
	});

	it("creates subdirectory structure in trash", async () => {
		const filePath = writeSessionFile(
			"deeply/nested/project/session.jsonl",
			'{"type":"message","text":"deep"}\n',
		);
		const candidate = makeCandidate(filePath);

		const result = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});

		expect(result.movedCount).toBe(1);
		const trashPath = join(
			trashDir,
			result.trashSubdir,
			"deeply",
			"nested",
			"project",
			"session.jsonl",
		);
		expect(existsSync(trashPath)).toBe(true);
	});
});

describe("listTrashIn", () => {
	it("returns empty when trash dir doesn't exist", async () => {
		const result = await listTrashIn(join(tmpdir(), "nonexistent-trash"));
		expect(result.subdirs).toEqual([]);
		expect(result.totalSize).toBe(0);
	});

	it("returns subdirectories with total size", async () => {
		const subdir = join(trashDir, "2026-01-15T00-00-00-000Z");
		mkdirSync(subdir, { recursive: true });
		writeFileSync(join(subdir, "session.jsonl"), "0123456789");

		const result = await listTrashIn(trashDir);
		expect(result.subdirs).toContain("2026-01-15T00-00-00-000Z");
		expect(result.totalSize).toBeGreaterThan(0);
	});

	it("ignores non-directory entries in trash", async () => {
		writeFileSync(join(trashDir, "some-file.txt"), "hi");

		const result = await listTrashIn(trashDir);
		expect(result.subdirs).toEqual([]);
	});
});

describe("emptyTrashIn", () => {
	it("removes all trash subdirectories", async () => {
		// First, move a file into trash so we have something to delete.
		const filePath = writeSessionFile(
			"session.jsonl",
			'{"type":"message","text":"bye"}\n',
		);
		const candidate = makeCandidate(filePath);

		const moveResult = await moveToTrashIn({
			candidates: [candidate],
			sessionsDir,
			trashDir,
		});
		expect(moveResult.movedCount).toBe(1);

		// Now empty it.
		const result = await emptyTrashIn({ trashDir });
		expect(result.removedCount).toBe(1);
		expect(result.bytesFreed).toBeGreaterThan(0);

		// The trash subdirectory should be gone.
		const trashSubdir = join(trashDir, moveResult.trashSubdir);
		expect(existsSync(trashSubdir)).toBe(false);
	});

	it("returns zeros when trash is already empty", async () => {
		const result = await emptyTrashIn({ trashDir });
		expect(result.removedCount).toBe(0);
		expect(result.bytesFreed).toBe(0);
	});

	it("empties only the specified subdirectory", async () => {
		// Create two timestamped trash subdirs by moving files.
		const f1 = writeSessionFile("a.jsonl", '{"type":"message","text":"a"}\n');
		const f2 = writeSessionFile("b.jsonl", '{"type":"message","text":"b"}\n');

		const r1 = await moveToTrashIn({
			candidates: [makeCandidate(f1)],
			sessionsDir,
			trashDir,
		});
		const r2 = await moveToTrashIn({
			candidates: [makeCandidate(f2)],
			sessionsDir,
			trashDir,
		});

		// Delete only the first subdir.
		const result = await emptyTrashIn({
			trashDir,
			subdir: r1.trashSubdir,
		});
		expect(result.removedCount).toBe(1);

		// First subdir should be gone.
		expect(existsSync(join(trashDir, r1.trashSubdir))).toBe(false);
		// Second subdir should still exist.
		expect(existsSync(join(trashDir, r2.trashSubdir))).toBe(true);
	});
});
