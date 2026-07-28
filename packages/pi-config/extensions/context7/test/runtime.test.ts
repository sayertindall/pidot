/**
 * context7/test/runtime.test.ts
 *
 * Pure-helper tests for `truncateForDisplay` and `missingKeyMessage`.
 * Tests that hit the network or `~/.pi/agent/` are out of scope here;
 * the contract is "no fs, no network."
 */
import { describe, expect, it } from "vitest";
import { missingKeyMessage, truncateForDisplay } from "../runtime";

describe("missingKeyMessage", () => {
	it("mentions settings.json path", () => {
		expect(missingKeyMessage()).toContain("settings.json");
	});

	it("mentions CONTEXT7_API_KEY env var", () => {
		expect(missingKeyMessage()).toContain("CONTEXT7_API_KEY");
	});
});

describe("truncateForDisplay", () => {
	it("returns the original text when under the cap", () => {
		expect(truncateForDisplay("hello world", 100)).toBe("hello world");
	});

	it("truncates with a clear marker when over the cap", () => {
		const out = truncateForDisplay("a".repeat(100), 20);
		expect(out.length).toBeLessThan(100);
		expect(out).toContain("(truncated in TUI)");
	});

	it("respects boundary at exact cap", () => {
		expect(truncateForDisplay("0123456789", 10)).toBe("0123456789");
	});
});
