/**
 * UI helpers for the preset extension.
 *
 * Centralizes widget rendering and notifications. The runtime/commands
 * call into here so the active-preset indicator stays consistent.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setWidgetLine, widgetKey } from "../_shared/widget";
import type { Preset } from "./types";

const KEY = widgetKey("preset");

export function setActivePresetWidget(ctx: ExtensionContext, name: string | undefined): void {
	if (name === undefined) {
		setWidgetLine(ctx, KEY, undefined);
		return;
	}
	// The widget text is unstyled here — host pi themes the string when
	// rendered above the editor. Keep it short and skimmable.
	setWidgetLine(ctx, KEY, `preset:${name}`);
}

/** One-line description of a preset, for list output. */
export function describePreset(preset: Preset): string {
	const parts: string[] = [];
	if (preset.provider && preset.model) parts.push(`${preset.provider}/${preset.model}`);
	if (preset.thinkingLevel) parts.push(`thinking:${preset.thinkingLevel}`);
	if (preset.tools && preset.tools.length > 0) parts.push(`tools:${preset.tools.join(",")}`);
	if (preset.instructions) {
		const snippet = preset.instructions.length > 30 ? `${preset.instructions.slice(0, 27)}...` : preset.instructions;
		parts.push(`"${snippet}"`);
	}
	return parts.join(" | ");
}

/** Notify the user about a preset transition. */
export function notifyPresetChange(
	ctx: ExtensionContext,
	name: string | undefined,
	warnings: string[] = [],
): void {
	if (!ctx.hasUI) return;
	if (name === undefined) {
		ctx.ui.notify("Preset cleared", "info");
	} else {
		ctx.ui.notify(`Preset "${name}" activated`, "info");
	}
	for (const w of warnings) ctx.ui.notify(w, "warning");
}
