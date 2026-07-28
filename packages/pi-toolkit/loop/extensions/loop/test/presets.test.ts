/**
 * presets.test.ts
 *
 * Tests for buildPrompt, summarizeCondition, and getConditionText.
 */

import { describe, expect, it } from "vitest";
import { buildPrompt, getConditionText, summarizeCondition } from '../presets';

describe("buildPrompt", () => {
	it("returns the correct prompt for tests mode", () => {
		const prompt = buildPrompt("tests");
		expect(prompt).toContain("Run all tests");
		expect(prompt).toContain("signal_loop_success");
	});

	it("returns the correct prompt for self mode", () => {
		const prompt = buildPrompt("self");
		expect(prompt).toContain("Continue until you are done");
		expect(prompt).toContain("signal_loop_success");
	});

	it("returns the correct prompt for custom mode with a condition", () => {
		const prompt = buildPrompt("custom", "all linters are green");
		expect(prompt).toContain("all linters are green");
		expect(prompt).toContain("signal_loop_success");
	});

	it("returns a fallback prompt for custom mode with no condition", () => {
		const prompt = buildPrompt("custom");
		expect(prompt).toContain("the custom condition is satisfied");
		expect(prompt).toContain("signal_loop_success");
	});

	it("returns a fallback prompt for custom mode with whitespace condition", () => {
		const prompt = buildPrompt("custom", "   ");
		expect(prompt).toContain("the custom condition is satisfied");
	});
});

describe("summarizeCondition", () => {
	it("returns 'tests pass' for tests mode", () => {
		expect(summarizeCondition("tests")).toBe("tests pass");
	});

	it("returns 'done' for self mode", () => {
		expect(summarizeCondition("self")).toBe("done");
	});

	it("returns the condition text for custom mode", () => {
		expect(summarizeCondition("custom", "all linters pass")).toBe("all linters pass");
	});

	it("returns 'custom condition' fallback for custom mode with no condition", () => {
		expect(summarizeCondition("custom")).toBe("custom condition");
	});

	it("truncates long custom conditions to 48 chars", () => {
		const long = "this is a very long breakout condition that exceeds the limit";
		const result = summarizeCondition("custom", long);
		expect(result.length).toBeLessThanOrEqual(48);
		expect(result).toBe("this is a very long breakout condition that e...");
	});
});

describe("getConditionText", () => {
	it("returns 'tests pass' for tests mode", () => {
		expect(getConditionText("tests")).toBe("tests pass");
	});

	it("returns 'you are done' for self mode", () => {
		expect(getConditionText("self")).toBe("you are done");
	});

	it("returns the condition for custom mode", () => {
		expect(getConditionText("custom", "lint is clean")).toBe("lint is clean");
	});

	it("returns fallback for custom mode with no condition", () => {
		expect(getConditionText("custom")).toBe("custom condition");
	});
});
