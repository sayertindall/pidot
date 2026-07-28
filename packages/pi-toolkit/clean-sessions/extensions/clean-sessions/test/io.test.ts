/**
 * io.test.ts
 *
 * Unit tests for the I/O module: createLineReader, countLines.
 */

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countLines } from '../io';

describe("countLines", () => {
	it("returns 0 for an empty file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clean-sessions-io-"));
		const filePath = join(dir, "empty.jsonl");
		writeFileSync(filePath, "");

		const result = await countLines(filePath);
		expect(result).toBe(0);

		rmSync(dir, { recursive: true, force: true });
	});

	it("returns the correct count for a single-line file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clean-sessions-io-"));
		const filePath = join(dir, "single.jsonl");
		writeFileSync(filePath, "one line\n");

		const result = await countLines(filePath);
		expect(result).toBe(1);

		rmSync(dir, { recursive: true, force: true });
	});

	it("returns the correct count for a multi-line file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clean-sessions-io-"));
		const filePath = join(dir, "multi.jsonl");
		const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		) + "\n";
		writeFileSync(filePath, content);

		const result = await countLines(filePath);
		expect(result).toBe(100);

		rmSync(dir, { recursive: true, force: true });
	});

	it("returns the correct count for a file with no trailing newline", async () => {
		const dir = mkdtempSync(join(tmpdir(), "clean-sessions-io-"));
		const filePath = join(dir, "no-trailing.jsonl");
		writeFileSync(filePath, "line1\nline2\nline3");

		const result = await countLines(filePath);
		expect(result).toBe(3);

		rmSync(dir, { recursive: true, force: true });
	});
});
