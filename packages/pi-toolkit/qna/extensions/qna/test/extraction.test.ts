/**
 * extraction.test.ts
 *
 * Unit tests for the extraction module.
 * - extractQuestionsLocally: line-based extraction, no LLM
 * - parseExtractionResult: JSON parser, tolerates markdown wrapping
 * - selectExtractionModel: Codex mini → Haiku → current model
 */

import { describe, expect, it, vi } from "vitest";
import {
	extractQuestionsLocally,
	parseExtractionResult,
	selectExtractionModel,
} from '../extraction';
import type { ModelRegistryLike } from '../types';

function fakeModel(id: string, provider: string) {
	return {
		id,
		provider,
		api: "openai-completions" as const,
	} as any;
}

function fakeRegistry(overrides: Partial<ModelRegistryLike> = {}): ModelRegistryLike {
	return {
		find: vi.fn(() => undefined),
		getApiKeyAndHeaders: vi.fn(async () => ({ ok: false, error: "no key" })),
		...overrides,
	};
}

describe("extractQuestionsLocally", () => {
	it("returns no questions for empty text", () => {
		expect(extractQuestionsLocally("")).toEqual({ questions: [] });
	});

	it("returns no questions for text without question marks", () => {
		expect(extractQuestionsLocally("Just a statement.\nAnother one.")).toEqual({ questions: [] });
	});

	it("extracts a single question from a line ending in ?", () => {
		const result = extractQuestionsLocally("What is your name?");
		expect(result.questions).toEqual([{ question: "What is your name?" }]);
	});

	it("extracts multiple questions in order", () => {
		const result = extractQuestionsLocally(
			"First question?\nSecond question?\nThird?",
		);
		expect(result.questions).toEqual([
			{ question: "First question?" },
			{ question: "Second question?" },
			{ question: "Third?" },
		]);
	});

	it("strips common list markers (-, *, •, 1., 2.)", () => {
		const result = extractQuestionsLocally(
			"- One?\n* Two?\n• Three?\n1. Four?\n2) Five?",
		);
		expect(result.questions.map((q) => q.question)).toEqual([
			"One?",
			"Two?",
			"Three?",
			"Four?",
			"Five?",
		]);
	});

	it("ignores lines that contain ? but don't end with it", () => {
		const result = extractQuestionsLocally(
			"This is a question? But not really.\nDefinitely a question?",
		);
		expect(result.questions).toEqual([{ question: "Definitely a question?" }]);
	});
});

describe("parseExtractionResult", () => {
	it("parses bare JSON", () => {
		const text = JSON.stringify({
			questions: [
				{ question: "Q1?" },
				{ question: "Q2?", context: "ctx" },
			],
		});
		const result = parseExtractionResult(text);
		expect(result).toEqual({
			questions: [
				{ question: "Q1?" },
				{ question: "Q2?", context: "ctx" },
			],
		});
	});

	it("parses JSON wrapped in markdown code block", () => {
		const text = "```json\n" + JSON.stringify({ questions: [{ question: "Q?" }] }) + "\n```";
		expect(parseExtractionResult(text)).toEqual({ questions: [{ question: "Q?" }] });
	});

	it("parses JSON wrapped in unmarked code block", () => {
		const text = "```\n" + JSON.stringify({ questions: [] }) + "\n```";
		expect(parseExtractionResult(text)).toEqual({ questions: [] });
	});

	it("returns null on malformed JSON", () => {
		expect(parseExtractionResult("not json")).toBeNull();
	});

	it("returns null on JSON without questions array", () => {
		expect(parseExtractionResult(JSON.stringify({ result: "no questions key" }))).toBeNull();
	});

	it("returns null on JSON with non-array questions", () => {
		expect(parseExtractionResult(JSON.stringify({ questions: "not an array" }))).toBeNull();
	});

	it("returns empty result for valid JSON with empty questions array", () => {
		expect(parseExtractionResult(JSON.stringify({ questions: [] }))).toEqual({ questions: [] });
	});
});

describe("selectExtractionModel", () => {
	it("prefers Codex mini when available and authed", async () => {
		const codex = fakeModel("gpt-5.1-codex-mini", "openai-codex");
		const current = fakeModel("claude-sonnet", "anthropic");
		const registry = fakeRegistry({
			find: vi.fn((provider: string, id: string) => {
				if (provider === "openai-codex" && id === "gpt-5.1-codex-mini") return codex;
				return undefined;
			}),
			getApiKeyAndHeaders: vi.fn(async (model: any) => {
				if (model.provider === "openai-codex") {
					return { ok: true, apiKey: "codex-key", headers: { "x-provider": "codex" } };
				}
				return { ok: false };
			}),
		});
		const result = await selectExtractionModel(current, registry);
		expect(result?.model).toBe(codex);
		expect(result?.apiKey).toBe("codex-key");
	});

	it("falls back to Haiku when Codex is not authed", async () => {
		const haiku = fakeModel("claude-haiku-4-5", "anthropic");
		const current = fakeModel("claude-sonnet", "anthropic");
		const registry = fakeRegistry({
			find: vi.fn((provider: string, id: string) => {
				if (provider === "anthropic" && id === "claude-haiku-4-5") return haiku;
				return undefined;
			}),
			getApiKeyAndHeaders: vi.fn(async (model: any) => {
				if (model.id === "claude-haiku-4-5") {
					return { ok: true, apiKey: "haiku-key" };
				}
				return { ok: false };
			}),
		});
		const result = await selectExtractionModel(current, registry);
		expect(result?.model).toBe(haiku);
		expect(result?.apiKey).toBe("haiku-key");
	});

	it("falls back to current model when neither Codex nor Haiku work", async () => {
		const current = fakeModel("claude-sonnet", "anthropic");
		const registry = fakeRegistry({
			find: vi.fn(() => undefined),
			getApiKeyAndHeaders: vi.fn(async (model: any) => {
				if (model.id === "claude-sonnet") {
					return { ok: true, apiKey: "sonnet-key" };
				}
				return { ok: false };
			}),
		});
		const result = await selectExtractionModel(current, registry);
		expect(result?.model).toBe(current);
		expect(result?.apiKey).toBe("sonnet-key");
	});

	it("returns null when no model can be authed", async () => {
		const current = fakeModel("claude-sonnet", "anthropic");
		const registry = fakeRegistry();
		const result = await selectExtractionModel(current, registry);
		expect(result).toBeNull();
	});
});
