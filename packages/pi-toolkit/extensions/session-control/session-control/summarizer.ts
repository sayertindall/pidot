/**
 * summarizer.ts — AI-powered session summarization
 *
 * Handles get_summary RPC command. Selects cheapest available model
 * (Codex mini → Haiku → parent model), extracts messages since last
 * user prompt, and returns an AI-generated summary.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { Model, Api, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtractedMessage } from "./types";

const CODEX_MODEL_ID = "gpt-5.1-codex-mini";
const HAIKU_MODEL_ID = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a conversation summarizer. Create concise, accurate summaries that preserve key information, decisions, and outcomes.`;

const TURN_SUMMARY_PROMPT = `Summarize what happened in this conversation since the last user prompt. Focus on:
- What was accomplished
- Any decisions made
- Files that were read, modified, or created
- Any errors or issues encountered
- Current state/next steps

Be concise but comprehensive. Preserve exact file paths, function names, and error messages.`;

export function getLastAssistantMessage(ctx: ExtensionContext): ExtractedMessage | undefined {
	const branch = ctx.sessionManager.getBranch();

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!entry) continue;
		// SessionEntry is a union — message entries have type "message"
		const e = entry as { type: string; message?: { role?: string; content?: Array<{ type: string; text: string }>; timestamp?: number } };
		if (e.type === "message" && e.message?.role === "assistant") {
			const textParts = (e.message.content ?? [])
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text);
			if (textParts.length > 0) {
				return {
					role: "assistant",
					content: textParts.join("\n"),
					timestamp: e.message.timestamp ?? 0,
				};
			}
		}
	}
	return undefined;
}

export function getMessagesSinceLastPrompt(ctx: ExtensionContext): ExtractedMessage[] {
	const branch = ctx.sessionManager.getBranch();
	const messages: ExtractedMessage[] = [];

	let lastUserIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!entry) continue;
		const e = entry as { type: string; message?: { role?: string } };
		if (e.type === "message" && e.message?.role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	if (lastUserIndex === -1) return [];

	for (let i = lastUserIndex; i < branch.length; i++) {
		const entry = branch[i];
		if (!entry) continue;
		const e = entry as { type: string; message?: { role?: string; content?: unknown; timestamp?: number } };
		if (e.type === "message" && e.message?.role && (e.message.role === "user" || e.message.role === "assistant")) {
			const content = e.message.content;
			if (typeof content !== "object" || !content) continue;
			const textParts = (Array.isArray(content) ? content : [])
				.filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && (c as any).type === "text")
				.map((c) => (c as { text: string }).text);
			if (textParts.length > 0) {
				messages.push({
					role: e.message.role as "user" | "assistant",
					content: textParts.join("\n"),
					timestamp: e.message.timestamp ?? 0,
				});
			}
		}
	}

	return messages;
}

export async function formatSummary(
	ctx: ExtensionContext,
	messages: ExtractedMessage[],
): Promise<{ summary: string; model: string }> {
	const model = await selectSummarizationModel(ctx);
	if (!model) {
		throw new Error("No model available for summarization");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(auth.error || "No API key available");
	}

	const conversationText = messages
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const userMessage: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_SUMMARY_PROMPT}`,
			},
		],
		timestamp: Date.now(),
	};

	const response = await complete(
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal ?? undefined },
	);

	if (response.stopReason === "aborted" || response.stopReason === "error") {
		throw new Error("Summarization failed: " + response.stopReason);
	}

	const summary = (response.content as any[])
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n");

	return { summary, model: model.id };
}

async function selectSummarizationModel(
	ctx: ExtensionContext,
): Promise<Model<Api> | undefined> {
	const codexModel = ctx.modelRegistry.find("openai-codex", CODEX_MODEL_ID);
	if (codexModel) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(codexModel);
		if (auth.ok) return codexModel;
	}

	const haikuModel = ctx.modelRegistry.find("anthropic", HAIKU_MODEL_ID);
	if (haikuModel) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(haikuModel);
		if (auth.ok) return haikuModel;
	}

	return ctx.model ?? undefined;
}
