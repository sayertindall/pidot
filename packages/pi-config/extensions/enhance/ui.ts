/**
 * enhance/ui.ts
 *
 * Status widget (one widget key) and preset-list rendering.
 */
import type { EnhancePreset } from "./types";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export function renderWidget(activeName: string | undefined, theme: Theme): string[] {
	if (!activeName) return [theme.fg("dim" as ThemeColor, "enhance: off")];
	return [theme.fg("accent" as ThemeColor, `enhance: ${activeName}`)];
}

export function renderPresetList(presets: EnhancePreset[], theme: Theme): string {
	if (presets.length === 0) {
		return theme.fg("muted" as ThemeColor, "(no presets — drop a markdown file in ~/.pi/agent/pi-config/enhance/presets/)");
	}
	return presets
		.map((p) => `  ${theme.fg("accent" as ThemeColor, p.name)} ${theme.fg("dim" as ThemeColor, `(${p.mode})`)} — ${p.description}`)
		.join("\n");
}
