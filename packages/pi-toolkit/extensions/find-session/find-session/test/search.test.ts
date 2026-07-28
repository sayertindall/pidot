/**
 * search.test.ts
 *
 * Unit tests for the search module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "find-session-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function fakePi(
	execImpl: (cmd: string, args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string; killed: boolean }>,
) {
	return {
		exec: vi.fn(execImpl),
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
}

describe("parseRgJsonLine", () => {
	it("returns null for empty line", async () => {
		const { parseRgJsonLine } = await import("../search");
		expect(parseRgJsonLine("")).toBeNull();
	});

	it("returns null for non-match event types", async () => {
		const { parseRgJsonLine } = await import("../search");
		expect(parseRgJsonLine(JSON.stringify({ type: "begin", data: {} }))).toBeNull();
		expect(parseRgJsonLine(JSON.stringify({ type: "end", data: {} }))).toBeNull();
		expect(parseRgJsonLine(JSON.stringify({ type: "summary", data: {} }))).toBeNull();
	});

	it("returns null for malformed JSON", async () => {
		const { parseRgJsonLine } = await import("../search");
		expect(parseRgJsonLine("not json {")).toBeNull();
		expect(parseRgJsonLine("undefined")).toBeNull();
	});

	it("parses a well-formed match event", async () => {
		const { parseRgJsonLine } = await import("../search");
		const line = JSON.stringify({
			type: "match",
			data: {
				path: { text: "/home/user/sessions/project-x/2026-01-15-abc.jsonl" },
				line_number: 42,
				lines: { text: "auth rate limiter" },
			},
		});
		const result = parseRgJsonLine(line);
		expect(result).toEqual({
			filePath: "/home/user/sessions/project-x/2026-01-15-abc.jsonl",
			lineNumber: 42,
			matchedText: "auth rate limiter",
			projectLabel: "project-x",
		});
	});

	it("returns null when match event is missing required fields", async () => {
		const { parseRgJsonLine } = await import("../search");
		expect(
			parseRgJsonLine(JSON.stringify({ type: "match", data: { path: { text: "/x" } } })),
		).toBeNull();
	});

	it("truncates long matched text", async () => {
		const { parseRgJsonLine } = await import("../search");
		const longText = "x".repeat(500);
		const line = JSON.stringify({
			type: "match",
			data: {
				path: { text: "/tmp/s.jsonl" },
				line_number: 1,
				lines: { text: longText },
			},
		});
		const result = parseRgJsonLine(line);
		expect(result?.matchedText.length).toBeLessThanOrEqual(200);
		expect(result?.matchedText.endsWith("…")).toBe(true);
	});
});

describe("groupByFile", () => {
	it("returns [] for empty input", async () => {
		const { groupByFile } = await import("../search");
		expect(groupByFile([])).toEqual([]);
	});

	it("groups multiple matches in the same file", async () => {
		const { groupByFile } = await import("../search");
		const matches = [
			{ filePath: "/a.jsonl", lineNumber: 1, matchedText: "first", projectLabel: "a" },
			{ filePath: "/b.jsonl", lineNumber: 5, matchedText: "match1", projectLabel: "b" },
			{ filePath: "/b.jsonl", lineNumber: 10, matchedText: "match2", projectLabel: "b" },
		];
		const result = groupByFile(matches);
		expect(result).toHaveLength(2);
		const a = result.find((r) => r.filePath === "/a.jsonl");
		const b = result.find((r) => r.filePath === "/b.jsonl");
		expect(a?.matchCount).toBe(1);
		expect(b?.matchCount).toBe(2);
	});

	it("sorts by match count descending", async () => {
		const { groupByFile } = await import("../search");
		const matches = [
			{ filePath: "/low.jsonl", lineNumber: 1, matchedText: "x", projectLabel: "low" },
			{ filePath: "/high.jsonl", lineNumber: 1, matchedText: "x", projectLabel: "high" },
			{ filePath: "/high.jsonl", lineNumber: 2, matchedText: "x", projectLabel: "high" },
			{ filePath: "/high.jsonl", lineNumber: 3, matchedText: "x", projectLabel: "high" },
		];
		const result = groupByFile(matches);
		expect(result[0]?.filePath).toBe("/high.jsonl");
		expect(result[0]?.matchCount).toBe(3);
		expect(result[1]?.filePath).toBe("/low.jsonl");
	});
});

describe("searchSessionsIn", () => {
	it("returns [] on rg exit 1 (no matches)", async () => {
		const { searchSessionsIn } = await import("../search");
		const pi = fakePi(async () => ({ code: 1, stdout: "", stderr: "", killed: false }));
		const result = await searchSessionsIn(pi, "nope", tmp);
		expect(result).toEqual([]);
	});

	it("throws on rg timeout (killed)", async () => {
		const { searchSessionsIn } = await import("../search");
		const pi = fakePi(async () => ({ code: 0, stdout: "", stderr: "", killed: true }));
		await expect(searchSessionsIn(pi, "anything", tmp)).rejects.toThrow(/timed out/);
	});

	it("parses rg --json output and groups by file", async () => {
		const { searchSessionsIn } = await import("../search");
		const jsonA = JSON.stringify({
			type: "match",
			data: { path: { text: "/s/a.jsonl" }, line_number: 1, lines: { text: "auth" } },
		});
		const jsonB = JSON.stringify({
			type: "match",
			data: { path: { text: "/s/b.jsonl" }, line_number: 5, lines: { text: "auth" } },
		});
		const jsonB2 = JSON.stringify({
			type: "match",
			data: { path: { text: "/s/b.jsonl" }, line_number: 10, lines: { text: "auth again" } },
		});
		const begin = JSON.stringify({ type: "begin", data: {} });
		const summary = JSON.stringify({ type: "summary", data: {} });
		const stdout = [begin, jsonA, jsonB, jsonB2, summary].join("\n");
		const pi = fakePi(async () => ({ code: 0, stdout, stderr: "", killed: false }));
		const result = await searchSessionsIn(pi, "auth", tmp);
		expect(result).toHaveLength(2);
		const b = result.find((r) => r.filePath === "/s/b.jsonl");
		expect(b?.matchCount).toBe(2);
	});

	it("falls back to fs walk when rg exits with non-zero error code", async () => {
		const { searchSessionsIn } = await import("../search");
		const pi = fakePi(async () => ({ code: 2, stdout: "", stderr: "rg error", killed: false }));
		const result = await searchSessionsIn(pi, "anything", tmp);
		expect(Array.isArray(result)).toBe(true);
		// tmp is empty (no .jsonl files), so fallback returns [].
		expect(result).toEqual([]);
	});

	it("falls back to fs walk when rg is missing (exec throws)", async () => {
		const { searchSessionsIn } = await import("../search");
		const pi = fakePi(async () => {
			throw new Error("ENOENT rg");
		});
		const result = await searchSessionsIn(pi, "anything", tmp);
		expect(Array.isArray(result)).toBe(true);
	});

	it("caps result at MAX_RESULTS (50)", async () => {
		const { searchSessionsIn } = await import("../search");
		const matches: string[] = [];
		for (let i = 0; i < 100; i++) {
			matches.push(
				JSON.stringify({
					type: "match",
					data: {
						path: { text: `/s/file-${i}.jsonl` },
						line_number: 1,
						lines: { text: "auth" },
					},
				}),
			);
		}
		const pi = fakePi(async () => ({
			code: 0,
			stdout: matches.join("\n"),
			stderr: "",
			killed: false,
		}));
		const result = await searchSessionsIn(pi, "auth", tmp);
		expect(result.length).toBeLessThanOrEqual(50);
	});

	it("passes the correct rg args (literal, json, glob, query, dir)", async () => {
		const { searchSessionsIn } = await import("../search");
		const pi = fakePi(async () => ({ code: 1, stdout: "", stderr: "", killed: false }));
		await searchSessionsIn(pi, "auth", "/tmp/sessions");
		expect(pi.exec).toHaveBeenCalledWith(
			"rg",
			["-i", "-F", "--json", "--max-columns=200", "-g", "*.jsonl", "auth", "/tmp/sessions"],
			{ signal: undefined, timeout: expect.any(Number) as unknown as number },
		);
	});
});

describe("searchSessionsFallbackIn", () => {
	it("returns [] when dir does not exist", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		const result = await searchSessionsFallbackIn("anything", "/nonexistent/dir/xyz");
		expect(result).toEqual([]);
	});

	it("returns [] when signal is already aborted", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		mkdirSync(tmp, { recursive: true });
		const controller = new AbortController();
		controller.abort();
		const result = await searchSessionsFallbackIn("anything", tmp, controller.signal);
		expect(result).toEqual([]);
	});

	it("walks the dir and substring-matches per file", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		const sub = join(tmp, "project-a");
		mkdirSync(sub, { recursive: true });
		writeFileSync(join(sub, "session-1.jsonl"), "header line\nauth rate limiter works\nfooter\n");
		writeFileSync(join(sub, "session-2.jsonl"), "unrelated content\n");
		writeFileSync(join(sub, "session-3.jsonl"), "AUTH upper case also matches\n");
		writeFileSync(join(sub, "notes.txt"), "this is not a jsonl and should be ignored\n");

		const result = await searchSessionsFallbackIn("auth", tmp);
		expect(result).toHaveLength(2);
		const filePaths = result.map((r) => r.filePath).sort();
		expect(filePaths).toEqual([join(sub, "session-1.jsonl"), join(sub, "session-3.jsonl")].sort());
	});

	it("is case-insensitive", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		writeFileSync(join(tmp, "s.jsonl"), "UPPERCASE TARGET\n");
		const result = await searchSessionsFallbackIn("uppercase", tmp);
		expect(result).toHaveLength(1);
		expect(result[0]?.firstMatch.matchedText).toBe("UPPERCASE TARGET");
	});

	it("ignores subdirectories without .jsonl files", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		const sub = join(tmp, "empty");
		mkdirSync(sub, { recursive: true });
		const result = await searchSessionsFallbackIn("anything", tmp);
		expect(result).toEqual([]);
	});

	it("returns first match per file (matchCount always 1 in fallback)", async () => {
		const { searchSessionsFallbackIn } = await import("../search");
		writeFileSync(join(tmp, "s.jsonl"), "auth line 1\nauth line 2\nauth line 3\n");
		const result = await searchSessionsFallbackIn("auth", tmp);
		expect(result).toHaveLength(1);
		expect(result[0]?.matchCount).toBe(1);
		expect(result[0]?.firstMatch.lineNumber).toBe(1);
	});
});
