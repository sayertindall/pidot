/**
 * enhance/runtime.ts
 *
 * The prompt-rewriter itself. Uses `complete` from pi-ai to call the
 * active model with the preset's system prompt. Stateless beyond the
 * snapshot passed in.
 *
 * The single LLM-callable tool `enhance_prompt` is registered in
 * `index.ts` and uses this module.
 */
import { complete, uuidv7 } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { EnhancePreset } from "./types";

export type EnhanceResult = {
	rewritten: string;
	preset: EnhancePreset;
};

const DEFAULT_SYSTEM_PROMPT = `You rewrite user prompts to be clearer, more specific, and more actionable.

CRITICAL RULES:
- Preserve ALL implicit references. If the user says "the command above" or "that error" or "the config we discussed," KEEP those references exactly as-is. The final prompt will have full conversation context the model can see.
- Do NOT add new requests or ask clarifying questions. You are rewriting, not responding.
- Do NOT add "I'd be happy to help" or "Could you share..." — this is prepended to the user's actual message, not a standalone response.
- Remove ambiguity only where the text itself is unclear. Make vague nouns concrete ("it" → "the config file").
- Keep it concise. Shorter is better if nothing is lost.
- Output ONLY the rewritten prompt. No preamble, no explanation, no markdown fencing.`;

export async function enhancePrompt(
	text: string,
	preset: EnhancePreset,
	model: Model<any> | undefined,
	registry: ModelRegistry,
	conversationContext?: string,
): Promise<EnhanceResult | undefined> {
	if (!model) return undefined;

	const auth = await registry.getApiKeyAndHeaders(model);
	if (!auth.ok) return undefined;
	if (!auth.apiKey) return undefined;

	const systemPrompt = preset.systemPrompt.length > 0 ? preset.systemPrompt : DEFAULT_SYSTEM_PROMPT;

	const userContent = conversationContext
		? `Recent conversation context:\n${conversationContext}\n\n---\nUser prompt to rewrite:\n${text}`
		: text;

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: userContent }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			systemPrompt,
			cacheRetention: "none",
			sessionId: uuidv7(),
		},
	);

	const text2 = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();

	if (!text2) return undefined;
	return { rewritten: text2, preset };
}

/** Apply a preset's system prompt to an existing system prompt per its mode. */
export function applyPreset(preset: EnhancePreset, systemPrompt: string): string {
	if (preset.mode === "replace") return preset.systemPrompt;
	return `${systemPrompt}\n\n${preset.systemPrompt}`;
}
