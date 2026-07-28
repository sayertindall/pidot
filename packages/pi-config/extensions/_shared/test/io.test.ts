import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStateOrEmpty, writeStateAtomic, encodeSessionId, quarantineCorrupt } from "../io";

describe("io", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-config-io-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe("readStateOrEmpty", () => {
		it("returns empty when file is missing", () => {
			const result = readStateOrEmpty(join(tmp, "missing.json"), { default: true });
			expect(result).toEqual({ default: true });
		});

		it("parses valid JSON", () => {
			const path = join(tmp, "ok.json");
			writeFileSync(path, JSON.stringify({ a: 1 }));
			expect(readStateOrEmpty(path, {})).toEqual({ a: 1 });
		});

		it("quarantines corrupt files and returns empty", () => {
			const path = join(tmp, "bad.json");
			writeFileSync(path, "{ not valid json");
			const result = readStateOrEmpty(path, { fallback: "yes" });
			expect(result).toEqual({ fallback: "yes" });
			expect(existsSync(path)).toBe(false);
			const corrupt = readdirSync(tmp).find((f) => f.startsWith("bad.json.corrupt"));
			expect(corrupt).toBeDefined();
		});
	});

	describe("writeStateAtomic", () => {
		it("creates the file with valid JSON", () => {
			const path = join(tmp, "nested", "out.json");
			writeStateAtomic(path, { hello: "world" });
			expect(existsSync(path)).toBe(true);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hello: "world" });
		});

		it("does not leave .tmp files behind", () => {
			const path = join(tmp, "out.json");
			writeStateAtomic(path, { ok: 1 });
			const files = readdirSync(tmp).filter((f) => f.includes(".tmp"));
			expect(files).toEqual([]);
		});
	});

	describe("encodeSessionId", () => {
		it("encodes to base64url", () => {
			const encoded = encodeSessionId("abc/def");
			expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe("abc/def");
		});

		it("throws on empty input", () => {
			expect(() => encodeSessionId("")).toThrow();
		});
	});

	describe("quarantineCorrupt", () => {
		it("renames the file with a timestamp suffix", () => {
			const path = join(tmp, "data.json");
			writeFileSync(path, "garbage");
			quarantineCorrupt(path);
			expect(existsSync(path)).toBe(false);
			const files = readdirSync(tmp);
			expect(files.some((f) => f.startsWith("data.json.corrupt"))).toBe(true);
		});
	});
});
