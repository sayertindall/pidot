/**
* see/index.ts
*
* Vision delegation for text-only models (e.g. deepseek-v4-flash declares
* `input: ["text"]`, so pi's read tool omits image attachments). Registers a
* single tool `see` that shells out to the Codex CLI with a vision-capable
* model (default gpt-5.6-luna via the openai-codex provider) and returns a
* text description the active model can reason over.
*
* Tools (LLM-callable):
*   - see(paths, prompt?, model?)
*
* Command namespace: none.
*
* Persistent state: none — stateless, no config file, no data directory.
*
* Principle mapping:
*   1 TypeBox     — schemas.ts
*   2 markdown    — N/A
*   3 session     — N/A
*   4 widget      — N/A
*   5 debounce    — N/A
*   6 throw/warn  — codex absence / missing files / non-zero exit return isError
*   7 split       — schemas.ts / runtime.ts / index.ts
*   8 ns          — N/A (tool only)
*   9 schemas.ts  — present with full tool schema
*/
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL, describeImage } from "./runtime";
import { SeeParams } from "./schemas";

export default function seeExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "see",
		label: "See",
		description:
			"Look at an image with a vision-capable model (via the Codex CLI) and return a text " +
			"description. Use when the active model cannot process images (text-only models) or " +
			"when a screenshot, mockup, diagram, or photo needs precise visual reading: exact text " +
			"on screen, UI states, colors, layout, error dialogs.",
		parameters: SeeParams,
		async execute(_id, params, signal, _onUpdate, _ctx) {
			const { paths, prompt, model } = params as {
				paths: string[];
				prompt?: string;
				model?: string;
			};
			const started = Date.now();
			const descriptionPrompt =
				prompt ??
				"Describe this image in detail. Be precise about layout, colors, and any text " +
					"shown. Report UI elements, states, and notable details as structured text.";
			try {
				const text = await describeImage(paths, {
					prompt: descriptionPrompt,
					model,
					signal,
				});
				return {
					content: [{ type: "text" as const, text }],
					details: {
						ok: true,
						model: model ?? DEFAULT_MODEL,
						paths,
						latencyMs: Date.now() - started,
					},
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `see failed: ${(err as Error).message}`,
						},
					],
					details: { ok: false, reason: (err as Error).message },
					isError: true,
				};
			}
		},
	});
}
