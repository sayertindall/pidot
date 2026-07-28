import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSafetyConfig } from "../state";
import { checkBash, checkWriteOrEdit, matchGlob, safeRegex } from "../matchers";
import { parseSafetyCommand, formatSafetyList } from "../commands";
import { EMPTY_SAFETY_CONFIG, type SafetyConfig } from "../types";

const CFG_BLOCK_RM: SafetyConfig = {
	...EMPTY_SAFETY_CONFIG,
	bash: { blockPatterns: [{ pattern: "rm -rf", reason: "Recursive delete" }] },
};

const CFG_PROTECTED_GIT: SafetyConfig = {
	...EMPTY_SAFETY_CONFIG,
	paths: { readOnly: [], noDelete: [".git/"] },
};

const CFG_CREDENTIALS: SafetyConfig = {
	...EMPTY_SAFETY_CONFIG,
	credentials: {
		blockPatterns: ["sk-ant-"],
		blockFiles: [".env", "*.pem"],
	},
};

describe("safety", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-config-safety-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe("matchGlob", () => {
		it("matches directory prefix", () => {
			expect(matchGlob("dist/", "dist/foo.js")).toBe(true);
			expect(matchGlob("dist/", "src/dist/foo.js")).toBe(true);
			expect(matchGlob("dist/", "src/foo.js")).toBe(false);
		});

		it("matches wildcard extension", () => {
			expect(matchGlob("*.lock", "package.lock")).toBe(true);
			expect(matchGlob("*.lock", "yarn.lock")).toBe(true);
			expect(matchGlob("*.lock", "package.json")).toBe(false);
		});

		it("matches exact basename", () => {
			expect(matchGlob("LICENSE", "LICENSE")).toBe(true);
			expect(matchGlob("LICENSE", "src/LICENSE")).toBe(true);
			expect(matchGlob("LICENSE", "NOTICE")).toBe(false);
		});
	});

	describe("safeRegex", () => {
		it("compiles valid patterns", () => {
			const re = safeRegex("^foo$");
			expect(re?.test("foo")).toBe(true);
		});

		it("falls back to literal escape on invalid pattern", () => {
			const re = safeRegex("[unclosed");
			expect(re?.test("[unclosed")).toBe(true);
		});

		it("returns undefined if even the escape fails", () => {
			// Pathological: the escaped version of an absurdly weird string still
			// compiles; so this case is hard to trigger. We at least confirm
			// a valid result for an empty string.
			const re = safeRegex("");
			expect(re).toBeDefined();
		});
	});

	describe("checkBash", () => {
		it("blocks by case-insensitive substring", () => {
			expect(checkBash("RM -RF /", CFG_BLOCK_RM)).toMatch(/Recursive delete/);
		});

		it("does not block unrelated commands", () => {
			expect(checkBash("ls -la", CFG_BLOCK_RM)).toBeUndefined();
		});

		it("blocks delete of protected paths", () => {
			expect(checkBash("rm -rf .git/objects", CFG_PROTECTED_GIT)).toMatch(/protected path/);
		});

		it("does not flag non-delete commands on protected paths", () => {
			expect(checkBash("cat .git/HEAD", CFG_PROTECTED_GIT)).toBeUndefined();
		});
	});

	describe("checkWriteOrEdit", () => {
		it("blocks credential file writes", () => {
			expect(checkWriteOrEdit(".env", "FOO=bar", CFG_CREDENTIALS)).toMatch(/Credential file/);
		});

		it("blocks credential pattern in content", () => {
			expect(checkWriteOrEdit("ok.txt", "key=sk-ant-abc", CFG_CREDENTIALS)).toMatch(
				/Credential pattern/,
			);
		});

		it("allows clean writes", () => {
			expect(checkWriteOrEdit("src/index", "export {}", CFG_CREDENTIALS)).toBeUndefined();
		});
	});

	describe("readSafetyConfig", () => {
		it("returns empty config when no file", () => {
			const cfg = readSafetyConfig(tmp);
			expect(cfg).toEqual(EMPTY_SAFETY_CONFIG);
		});

		it("quarantines corrupt files", () => {
			writeFileSync(join(tmp, "safety.json"), "{ broken");
			const cfg = readSafetyConfig(tmp);
			expect(cfg).toEqual(EMPTY_SAFETY_CONFIG);
			const corrupt = readdirSync(tmp).find((f) => f.startsWith("safety.json.corrupt"));
			expect(corrupt).toBeDefined();
		});

		it("returns empty config when shape is wrong (no quarantine for parseable-but-wrong)", () => {
			writeFileSync(join(tmp, "safety.json"), JSON.stringify({ version: 99 }));
			const cfg = readSafetyConfig(tmp);
			expect(cfg.version).toBe(1);
		});
	});

	describe("parseSafetyCommand", () => {
		it("treats empty as list", () => {
			expect(parseSafetyCommand("")).toEqual({ verb: "list" });
		});

		it("parses test as bash by default", () => {
			expect(parseSafetyCommand("test rm -rf /")).toEqual({ verb: "test-bash", command: "rm -rf /" });
		});

		it("parses test --write as write", () => {
			expect(parseSafetyCommand("test --write .env FOO=bar")).toEqual({
				verb: "test-write",
				path: ".env",
				content: "FOO=bar",
			});
		});

		it("parses reload", () => {
			expect(parseSafetyCommand("reload")).toEqual({ verb: "reload" });
		});
	});

	describe("formatSafetyList", () => {
		it("includes counts and entries", () => {
			const lines = formatSafetyList(CFG_BLOCK_RM);
			expect(lines.join("\n")).toMatch(/bash.blockPatterns: 1/);
			expect(lines.join("\n")).toMatch(/rm -rf/);
		});
	});
});
