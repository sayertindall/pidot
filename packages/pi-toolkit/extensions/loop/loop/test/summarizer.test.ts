/**
 * summarizer.test.ts
 *
 * Tests for summarizeBreakoutCondition and selectSummaryModel.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// Mock complete from pi-ai/compat so we control the LLM response.
vi.mock("@earendil-works/pi-ai/compat", () => {
	let result: any = {
		stopReason: "stop",
		content: [{ type: "text", text: "loops until tests pass" }],
	};
	return {
		complete: vi.fn(async () => result),
		__setCompleteResult: (r: any) => {
			result = r;
		},
	};
});

import { summarizeBreakoutCondition, selectSummaryModel } from '../summarizer';

function fakeCtx(overrides: Record<string, any> = {}) {
	return {
		model: { id: "gpt-4o", provider: "openai" },
		modelRegistry: {
			find: vi.fn().mockReturnValue(null),
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-key", headers: {} })),
		},
		...overrides,
	} as any;
}

describe("selectSummaryModel", () => {
	it("returns null when ctx.model is null", async () => {
		const ctx = fakeCtx({ model: null });
		const result = await selectSummaryModel(ctx);
		expect(result).toBeNull();
	});

	it("returns the current model when auth is ok", async () => {
		const ctx = fakeCtx();
		const result = await selectSummaryModel(ctx);
		expect(result).not.toBeNull();
		expect(result!.apiKey).toBe("test-key");
		expect(result!.model).toBe(ctx.model);
	});

	it("prefers haiku when provider is anthropic and haiku is found", async () => {
		const haikuModel = { id: "claude-haiku-4-5", provider: "anthropic" };
		const ctx = fakeCtx({
			model: { id: "claude-sonnet-4", provider: "anthropic" },
			modelRegistry: {
				find: vi.fn().mockReturnValue(haikuModel),
				getApiKeyAndHeaders: vi.fn(async (m: any) => {
					if (m === haikuModel) return { ok: true, apiKey: "haiku-key", headers: {} };
					return { ok: true, apiKey: "sonnet-key", headers: {} };
				}),
			},
		});
		const result = await selectSummaryModel(ctx);
		expect(result!.apiKey).toBe("haiku-key");
		expect(result!.model).toBe(haikuModel);
	});

	it("returns null when auth is not ok", async () => {
		const ctx = fakeCtx({
			modelRegistry: {
				find: vi.fn().mockReturnValue(null),
				getApiKeyAndHeaders: vi.fn(async () => ({ ok: false })),
			},
		});
		const result = await selectSummaryModel(ctx);
		expect(result).toBeNull();
	});
});

describe("summarizeBreakoutCondition", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns the LLM-generated summary on success", async () => {
		const ctx = fakeCtx();
		const summary = await summarizeBreakoutCondition(ctx, "tests");
		expect(summary).toBe("loops until tests pass");
	});

	it("falls back to summarizeCondition when selectSummaryModel returns null", async () => {
		const ctx = fakeCtx({ model: null });
		const summary = await summarizeBreakoutCondition(ctx, "tests");
		expect(summary).toBe("tests pass");
	});

	it("falls back to summarizeCondition on aborted response", async () => {
		const compat = await import("@earendil-works/pi-ai/compat");
		(compat as any).__setCompleteResult({
			stopReason: "aborted",
			content: [],
		});
		const ctx = fakeCtx();
		const summary = await summarizeBreakoutCondition(ctx, "self");
		expect(summary).toBe("done");
	});

	it("falls back to summarizeCondition on error response", async () => {
		const compat = await import("@earendil-works/pi-ai/compat");
		(compat as any).__setCompleteResult({
			stopReason: "error",
			content: [],
		});
		const ctx = fakeCtx();
		const summary = await summarizeBreakoutCondition(ctx, "custom", "lint");
		expect(summary).toBe("lint");
	});

	it("falls back when the response content is empty", async () => {
		const compat = await import("@earendil-works/pi-ai/compat");
		(compat as any).__setCompleteResult({
			stopReason: "stop",
			content: [],
		});
		const ctx = fakeCtx();
		const summary = await summarizeBreakoutCondition(ctx, "tests");
		expect(summary).toBe("tests pass");
	});

	it("truncates summaries longer than 60 chars", async () => {
		const compat = await import("@earendil-works/pi-ai/compat");
		(compat as any).__setCompleteResult({
			stopReason: "stop",
			content: [{ type: "text", text: "this summary is way too long and exceeds the maximum allowed length for a loop widget" }],
		});
		const ctx = fakeCtx();
		const summary = await summarizeBreakoutCondition(ctx, "tests");
		expect(summary.length).toBeLessThanOrEqual(60);
		expect(summary.endsWith("...")).toBe(true);
	});
});
