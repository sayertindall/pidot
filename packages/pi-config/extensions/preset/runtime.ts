/**
 * Runtime: applying and clearing presets.
 *
 * Pure logic for what it means to apply / clear a preset. No
 * persistence, no UI. Accepts an `ApplyContext` so the entry point
 * can swap in real `pi.*` calls without leaking the extension API
 * into the runtime.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel as CoreThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Preset } from "./types";

// Presets can declare extended thinking levels (xhigh, max) that
// pi-agent-core doesn't accept. The runtime clamps to the core
// set before calling pi APIs.
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type CoreThinking = CoreThinkingLevel;
export const CORE_THINKING_LEVELS: ReadonlySet<CoreThinking> = new Set<CoreThinking>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
]);

export function clampToCoreThinking(level: ThinkingLevel): CoreThinking {
	return CORE_THINKING_LEVELS.has(level as CoreThinking) ? (level as CoreThinking) : "high";
}

/** Loose model type — we only pass it through. */
export interface AnyModel {
	provider?: string;
	id?: string;
	[key: string]: unknown;
}

/** Minimal subset of pi/ctx that runtime.ts needs. */
export interface ApplyContext {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	currentModel: AnyModel | undefined;
	currentThinking: ThinkingLevel;
	currentTools: string[];
}

/** Result of applying a preset. */
export interface ApplyResult {
	ok: boolean;
	warnings: string[];
	appliedName: string;
}

/** Filter a preset's tool list against the tools pi actually has. */
export function filterValidTools(
	presetTools: string[] | undefined,
	allToolNames: string[],
): { valid: string[]; invalid: string[] } {
	if (!presetTools || presetTools.length === 0) return { valid: [], invalid: [] };
	const valid: string[] = [];
	const invalid: string[] = [];
	const known = new Set(allToolNames);
	for (const tool of presetTools) {
		if (known.has(tool)) valid.push(tool);
		else invalid.push(tool);
	}
	return { valid, invalid };
}

export interface OriginalState {
	model: AnyModel | undefined;
	thinkingLevel: ThinkingLevel;
	tools: string[];
}

/**
 * Apply a preset to the current session. `originalState` is updated
 * with the first-ever snapshot so `clearPreset` can restore it.
 */
export async function applyPreset(
	name: string,
	preset: Preset,
	apply: ApplyContext,
	_originalState: OriginalState | undefined,
): Promise<ApplyResult> {
	const warnings: string[] = [];

	// Model
	if (preset.provider && preset.model) {
		const model = apply.ctx.modelRegistry.find(preset.provider, preset.model);
		if (model) {
			const ok = await apply.pi.setModel(model);
			if (!ok) warnings.push(`No API key for ${preset.provider}/${preset.model}`);
		} else {
			warnings.push(`Model not found: ${preset.provider}/${preset.model}`);
		}
	}

	// Thinking level (clamp to core set; preset may declare xhigh/max)
	if (preset.thinkingLevel) {
		apply.pi.setThinkingLevel(clampToCoreThinking(preset.thinkingLevel));
	}

	// Tools
	if (preset.tools && preset.tools.length > 0) {
		const allTools = apply.pi.getAllTools().map((t) => t.name);
		const { valid, invalid } = filterValidTools(preset.tools, allTools);
		if (invalid.length > 0) {
			warnings.push(`Unknown tools: ${invalid.join(", ")}`);
		}
		if (valid.length > 0) {
			apply.pi.setActiveTools(valid);
		}
	}

	return { ok: true, warnings, appliedName: name };
}

/**
 * Clear the active preset and restore the original model/thinking/tools.
 * Falls back to the default tool set if no snapshot was ever taken.
 */
export function clearPreset(original: OriginalState | undefined, apply: ApplyContext): void {
	if (original) {
		if (original.model) {
			void apply.pi.setModel(original.model as unknown as Parameters<typeof apply.pi.setModel>[0]);
		}
		apply.pi.setThinkingLevel(clampToCoreThinking(original.thinkingLevel));
		apply.pi.setActiveTools(original.tools);
	} else {
		apply.pi.setActiveTools(["read", "bash", "edit", "write"]);
	}
}

/** Compute the next preset in a cycle: ["(none)", ...names]. */
export function nextCycleName(activeName: string | undefined, names: string[]): string {
	const cycle = ["(none)", ...names];
	const current = activeName ?? "(none)";
	const idx = cycle.indexOf(current);
	return cycle[(idx + 1) % cycle.length] ?? "(none)";
}
