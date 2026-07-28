import { describe, expect, it } from "vitest";
import { formatPercent, formatContext, usageFields } from '../usage';
import type { GoalRuntimeState } from '../types';

describe("formatPercent", () => {
	it("returns ? for null", () => {
		expect(formatPercent(null)).toBe("?");
	});

	it("returns ? for undefined", () => {
		expect(formatPercent(undefined)).toBe("?");
	});

	it("formats a number", () => {
		expect(formatPercent(87)).toBe("87%");
	});

	it("rounds decimals", () => {
		expect(formatPercent(87.6)).toBe("88%");
	});
});

describe("formatContext", () => {
	it("shows current / threshold", () => {
		const state = {
			lastContextPercent: 87,
			thresholdPercent: 95,
		} as GoalRuntimeState;
		expect(formatContext(state)).toBe("87% / 95%");
	});

	it("shows ? for null context", () => {
		const state = {
			lastContextPercent: null,
			thresholdPercent: 95,
		} as GoalRuntimeState;
		expect(formatContext(state)).toBe("? / 95%");
	});
});

describe("usageFields", () => {
	it("extracts fields from usage object", () => {
		const fields = usageFields({ percent: 50, tokens: 1000, contextWindow: 200000 });
		expect(fields.contextPercent).toBe(50);
		expect(fields.contextTokens).toBe(1000);
		expect(fields.contextWindow).toBe(200000);
	});

	it("falls back to runtime state", () => {
		const state = {
			lastContextPercent: 99,
			lastContextTokens: 50000,
			contextWindow: 200000,
		} as GoalRuntimeState;
		const fields = usageFields(undefined, state);
		expect(fields.contextPercent).toBe(99);
	});

	it("returns nulls when nothing is available", () => {
		const fields = usageFields(undefined);
		expect(fields.contextPercent).toBeNull();
		expect(fields.contextTokens).toBeNull();
		expect(fields.contextWindow).toBeNull();
	});
});
