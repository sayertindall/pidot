/**
 * Preset types.
 *
 * On-disk keys are snake_case for durability. In-memory keys are
 * camelCase for ergonomics. The conversion happens at the schema
 * boundary (TypeBox) and the io boundary (readStateOrEmpty).
 *
 * The preset definition is user-editable (presets.json). The state
 * record (which preset is active) is internal and lives at
 * `preset/state.json`.
 */

import type { ThinkingLevel } from "./runtime";

/** A user-defined preset (presets.json entries). In-memory shape. */
export interface Preset {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	instructions?: string;
}

/** In-memory active preset + the original model/thinking/tools we started with. */
export interface PresetState {
	activeName: string | undefined;
	original: import("./runtime").OriginalState | undefined;
}

/** The on-disk shape of the persisted state. Snake_case keys. */
export interface PersistedPresetState {
	active_name?: string;
}
