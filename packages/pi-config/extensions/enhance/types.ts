/**
 * enhance/types.ts
 *
 * Prompt enhancement extension. Two distinct concepts:
 *   - Preset:  a user-authored rewrite style (markdown + frontmatter)
 *   - State:   which preset is active right now
 *
 * Persistent state lives at:
 *   ~/.pi/agent/pi-config/enhance/state.json   (cross-session, atomic)
 *   ~/.pi/agent/pi-config/enhance/presets/*.md  (user-authored, parsed at load)
 */

export type EnhancePreset = {
	name: string;
	description: string;
	/** "append" | "replace" — how to apply the system prompt. */
	mode: "append" | "replace";
	systemPrompt: string;
	filePath: string;
};

export type EnhanceState = {
	activeName?: string;
};

/** In-memory record combining persisted state and runtime cache. */
export type EnhanceSnapshot = {
	active: EnhancePreset | null;
	available: EnhancePreset[];
};
