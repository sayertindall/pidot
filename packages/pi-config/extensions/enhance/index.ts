/**
 * enhance/index.ts
 *
 * Prompt enhancement via the active model. Optional preset (markdown +
 * frontmatter) appends or replaces the system prompt. Tool:
 * `enhance_prompt(text, preset?)`. Command: `/enhance ...`.
 *
 * Persistent state (cross-session):
 *   ~/.pi/agent/pi-config/enhance/state.json
 *
 * User-authored presets:
 *   ~/.pi/agent/pi-config/enhance/presets/*.md
 *
 * Principle mapping:
 *   1 TypeBox     — schemas.ts
 *   2 markdown    — presets/*.md parsed via parseFrontmatter
 *   3 session     — N/A (state is cross-session)
 *   4 widget      — renderWidget
 *   5 debounce    — N/A (writes are infrequent)
 *   6 throw/warn  — preset parse failures silently skip
 *   7 split       — types/schemas/state/runtime/ui/commands as own files
 *   8 ns          — /enhance
 *   9 schemas.ts  — present with full schemas
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { HELP_TEXT, parseEnhanceArgs } from "./commands";
import { applyPreset, enhancePrompt } from "./runtime";
import { loadPresets, mutateState, readState } from "./state";
import { EnhancePromptParams } from "./schemas";
import { renderPresetList } from "./ui";
import type { EnhancePreset, EnhanceState } from "./types";


/** Extract the last few user/assistant messages from the session branch as plain text context. */
function extractRecentContext(ctx: ExtensionContext, maxEntries = 8): string {
	try {
		const branch = ctx.sessionManager.getBranch() as ReadonlyArray<{ role?: string; content?: unknown }>;
		if (!Array.isArray(branch) || branch.length === 0) return "";
		const recent = branch.slice(-maxEntries);
		const lines: string[] = [];
		for (const entry of recent) {
			const role = entry.role ?? "";
			const content = extractTextContent(entry.content);
			if (!content) continue;
			if (role === "assistant") {
				// Truncate long assistant responses to keep context digestible
				const truncated = content.length > 500 ? content.slice(0, 500) + "…" : content;
				lines.push(`Assistant: ${truncated}`);
			} else if (role === "user") {
				lines.push(`User: ${content}`);
			}
		}
		return lines.join("\n");
	} catch {
		return "";
	}
}

/** Best-effort extraction of text content from a message content block. */
function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is { type: string; text: string } => typeof c === "object" && c !== null && (c as any).type === "text")
			.map((c) => (c as any).text ?? "")
			.join("");
	}
	return "";
}

export default function enhanceExtension(pi: ExtensionAPI): void {
	let presets: EnhancePreset[] = [];
	let activeName: string | undefined;
	let originalText: string | undefined;

	function activePreset(): EnhancePreset | undefined {
		if (!activeName) return undefined;
		return presets.find((p) => p.name === activeName);
	}


	async function setActive(name: string | undefined): Promise<void> {
		activeName = name;
		const next: EnhanceState = name ? { activeName: name } : {};
		await mutateState(() => next);
	}

	pi.on("session_start", (_event, _ctx) => {
		presets = loadPresets();
		const state = readState();
		activeName = state.activeName;
	});

	pi.on("session_shutdown", () => {});

	pi.on("before_agent_start", (event) => {
		const preset = activePreset();
		if (!preset) return undefined;
		return { systemPrompt: applyPreset(preset, event.systemPrompt) };
	});

	pi.registerTool({
		name: "enhance_prompt",
		label: "Enhance Prompt",
		description:
			"Rewrite a prompt for clarity using the active enhance preset (or one " +
			"passed inline). Returns the rewritten text and the preset used.",
		parameters: EnhancePromptParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { text, preset: presetName } = params as { text: string; preset?: string };
			const preset = presetName
				? presets.find((p) => p.name === presetName)
				: activePreset();
			if (!preset) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No enhance preset active. Use /enhance preset <name> first.",
						},
					],
					details: { ok: false, reason: "no-preset" as const },
					isError: true,
				};
			}
			const result = await enhancePrompt(text, preset, ctx.model, ctx.modelRegistry, extractRecentContext(ctx));
			if (!result) {
				return {
					content: [{ type: "text" as const, text: "Enhance failed: model unavailable or empty result." }],
					details: { ok: false, reason: "model-unavailable" as const },
					isError: true,
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Preset: ${result.preset.name} (${result.preset.mode})\n\n${result.rewritten}`,
					},
				],
				details: { preset: result.preset.name, mode: result.preset.mode },
			};
		},
	});

	pi.registerCommand("enhance", {
		description: "Enhance prompts via the active model. Usage: /enhance <on|off|preset|list|rewrite>",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const cmd = parseEnhanceArgs(args);
			switch (cmd.kind) {
				case "on":
					if (!activeName) {
						const first = presets[0];
						if (first) await setActive(first.name);
						else ctx.ui.notify("No presets available. Add one to ~/.pi/agent/pi-config/enhance/presets/.", "warning");
					}
					ctx.ui.notify(`Enhance: ${activeName ?? "off"}`, "info");
					return;
				case "off":
					await setActive(undefined);
					ctx.ui.notify("Enhance off", "info");
					return;
				case "preset": {
					const found = presets.find((p) => p.name === cmd.name);
					if (!found) {
						ctx.ui.notify(`Unknown preset: ${cmd.name}. Use /enhance list.`, "error");
						return;
					}
					await setActive(found.name);
					ctx.ui.notify(`Enhance preset: ${found.name}`, "info");
					return;
				}
				case "list": {
					const list = renderPresetList(presets, ctx.ui.theme);
					ctx.ui.notify(`Enhance presets:\n${list}`, "info");
					return;
				}
				case "rewrite": {
					const target = cmd.text || ctx.ui.getEditorText();
					if (!target.trim()) {
						ctx.ui.notify("Nothing to enhance", "warning");
						return;
					}
					const preset = activePreset();
					if (!preset) {
						ctx.ui.notify("No active preset. Use /enhance preset <name> first.", "warning");
						return;
					}
					ctx.ui.notify("Enhancing…", "info");
					const result = await enhancePrompt(target, preset, ctx.model, ctx.modelRegistry, extractRecentContext(ctx));
					if (!result) {
						ctx.ui.notify("Enhance failed", "error");
						return;
					}
					if (originalText === undefined) originalText = target;
					ctx.ui.setEditorText(result.rewritten);
					ctx.ui.notify(`Enhanced with preset "${preset.name}"`, "info");
					return;
				}
				case "help":
					ctx.ui.notify(HELP_TEXT, "info");
					return;
			}
		},
	});

	pi.registerShortcut(Key.ctrlShift("e"), {
		description: "Enhance current prompt",
		handler: async (ctx) => {
			const text = ctx.hasUI ? ctx.ui.getEditorText() : undefined;
			if (!text?.trim()) {
				if (ctx.hasUI) ctx.ui.notify("Nothing to enhance", "warning");
				return;
			}
			const preset = activePreset();
			if (!preset) {
				if (ctx.hasUI) ctx.ui.notify("No active preset. Use /enhance preset <name>.", "warning");
				return;
			}
			if (ctx.hasUI) ctx.ui.notify("Enhancing…", "info");
			const result = await enhancePrompt(text, preset, ctx.model, ctx.modelRegistry, extractRecentContext(ctx));
			if (!result || !ctx.hasUI) return;
			if (originalText === undefined) originalText = text;
			ctx.ui.setEditorText(result.rewritten);
			ctx.ui.notify(`Enhanced with preset "${preset.name}"`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlShift("z"), {
		description: "Undo prompt enhance",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			if (originalText === undefined) {
				ctx.ui.notify("Nothing to undo", "info");
				return;
			}
			ctx.ui.setEditorText(originalText);
			originalText = undefined;
			ctx.ui.notify("Restored original prompt", "info");
		},
	});
}
