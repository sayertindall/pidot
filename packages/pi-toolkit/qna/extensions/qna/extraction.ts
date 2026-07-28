/**
 * pi-toolkit-qna — extraction
 *
 * Two ways to pull questions out of an assistant message:
 *  1. Local, line-based extraction (cheap, no LLM call). Used first;
 *     if it finds questions, we skip the LLM entirely.
 *  2. LLM-based extraction via a small model (Codex mini, then Haiku,
 *     then the current model). Used when local extraction finds
 *     nothing.
 *
 * Plus the JSON parser for the LLM's response, which tolerates
 * markdown-wrapped JSON.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { Api, Model, UserMessage } from "@earendil-works/pi-ai";
import type { ExtractedQuestion, ExtractionResult, ModelRegistryLike, ModelWithAuth } from "./types";

/** System prompt for the LLM extractor. */
export const EXTRACTION_SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

/** Preferred small models for extraction. First one wins (if its auth is OK). */
const CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const CODEX_PROVIDER = "openai-codex";
const HAIKU_MODEL_ID = "claude-haiku-4-5";
const HAIKU_PROVIDER = "anthropic";

/**
 * Line-based extraction. Scans for lines ending in `?` after stripping
 * common list markers. Cheap, no network call. Returns an
 * ExtractionResult; `questions` is empty if no candidates found.
 */
export function extractQuestionsLocally(text: string): ExtractionResult {
	const questions: ExtractedQuestion[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line.includes("?")) continue;
		const cleaned = line
			.replace(/^[-*•]\s+/, "")
			.replace(/^\d+[.)]\s+/, "")
			.trim();
		if (cleaned.endsWith("?")) {
			questions.push({ question: cleaned });
		}
	}
	return { questions };
}

/**
 * Parse the JSON response from the LLM. Tolerates markdown-wrapped
 * JSON. Returns null if the response isn't a valid ExtractionResult.
 */
export function parseExtractionResult(text: string): ExtractionResult | null {
	try {
		// Try to find JSON in the response (it might be wrapped in markdown code blocks).
		let jsonStr = text;
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			jsonStr = jsonMatch[1]?.trim() ?? text;
		}
		const parsed = JSON.parse(jsonStr);
		if (parsed && Array.isArray(parsed.questions)) {
			return parsed as ExtractionResult;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Pick the best small model for extraction. Order: Codex mini
 * (if auth OK) → Haiku (if auth OK) → current model (fallback).
 */
export async function selectExtractionModel(
	currentModel: Model<Api>,
	modelRegistry: ModelRegistryLike,
): Promise<ModelWithAuth | null> {
	const codexModel = modelRegistry.find(CODEX_PROVIDER, CODEX_MODEL_ID);
	if (codexModel) {
		const result = await modelRegistry.getApiKeyAndHeaders(codexModel);
		if (result.ok && result.apiKey) {
			return { model: codexModel, apiKey: result.apiKey, headers: result.headers };
		}
	}

	const haikuModel = modelRegistry.find(HAIKU_PROVIDER, HAIKU_MODEL_ID);
	if (haikuModel) {
		const result = await modelRegistry.getApiKeyAndHeaders(haikuModel);
		if (result.ok && result.apiKey) {
			return { model: haikuModel, apiKey: result.apiKey, headers: result.headers };
		}
	}

	const result = await modelRegistry.getApiKeyAndHeaders(currentModel);
	if (result.ok && result.apiKey) {
		return { model: currentModel, apiKey: result.apiKey, headers: result.headers };
	}

	return null;
}

/**
 * Call the LLM to extract questions from `text`. Returns null on
 * abort, error, or parse failure.
 */
export async function extractQuestionsWithLLM(
	text: string,
	selection: ModelWithAuth,
	signal?: AbortSignal,
): Promise<ExtractionResult | null> {
	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};

	const response = await complete(
		selection.model,
		{ systemPrompt: EXTRACTION_SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: selection.apiKey, headers: selection.headers, signal },
	);

	if (response.stopReason === "aborted" || response.stopReason === "error") {
		return null;
	}

	const responseText = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return parseExtractionResult(responseText);
}
