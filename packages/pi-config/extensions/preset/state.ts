/**
 * State I/O for the preset extension.
 *
 * On-disk: snake_case. In-memory: camelCase. The `toInMemory` /
 * `toOnDisk` helpers handle the conversion. Per-entry validation means
 * one bad preset doesn't take down the rest.
 *
 * Eager writes (lifecycle transitions like "preset activated") go
 * through `persistStateEager`. The active preset is not
 * high-frequency activity, so we don't need a debounced persister.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { mutateStateEager } from "../_shared/state";
import { quarantineCorrupt, readStateOrEmpty } from "../_shared/io";
import type { Diagnostic } from "../_shared/types";
import { PresetSchema } from "./schemas";
import type { PersistedPresetState, Preset } from "./types";

const PRESETS_FILE = "presets.json";
const STATE_FILE = "state.json";

/** Result of loading presets.json. */
export interface PresetsLoadResult {
	presets: Record<string, Preset>;
	diagnostics: Diagnostic[];
}

/** Convert an on-disk (snake_case) preset to in-memory (camelCase). */
export function toInMemory(raw: unknown): Preset {
	const obj = (raw ?? {}) as Record<string, unknown>;
	const out: Preset = {};
	if (typeof obj.provider === "string") out.provider = obj.provider;
	if (typeof obj.model === "string") out.model = obj.model;
	if (typeof obj.thinking_level === "string") {
		out.thinkingLevel = obj.thinking_level as Preset["thinkingLevel"];
	}
	if (Array.isArray(obj.tools)) {
		out.tools = obj.tools.filter((t): t is string => typeof t === "string");
	}
	if (typeof obj.instructions === "string") out.instructions = obj.instructions;
	return out;
}

/** Load presets.json, validating per-entry and converting to camelCase. */
export function loadPresets(featureDir: string): PresetsLoadResult {
	const path = join(featureDir, PRESETS_FILE);
	if (!existsSync(path)) return { presets: {}, diagnostics: [] };

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		quarantineCorrupt(path);
		return {
			presets: {},
			diagnostics: [
				{ level: "warning", source: path, message: "Could not parse presets.json; moved to .corrupt-*." },
			],
		};
	}

	// Top-level: must be a plain object. Per-entry validation handles the
	// individual shapes; we don't require every entry to be valid because
	// one bad preset shouldn't take down the rest.
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			presets: {},
			diagnostics: [
				{
					level: "warning",
					source: path,
					message: "presets.json must be a record of named presets",
				},
			],
		};
	}

	// Per-entry validation; convert valid entries to in-memory shape.
	const diagnostics: Diagnostic[] = [];
	const presets: Record<string, Preset> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (Value.Check(PresetSchema, value)) {
			presets[key] = toInMemory(value);
		} else {
			diagnostics.push({
				level: "warning",
				source: `${path}#${key}`,
				message: "Dropped: shape mismatch",
			});
		}
	}
	return { presets, diagnostics };
}

/** Read the persisted preset state, or an empty record. */
export function loadPersistedState(featureDir: string): PersistedPresetState {
	const path = join(featureDir, STATE_FILE);
	return readStateOrEmpty<PersistedPresetState>(path, {});
}

/** Eagerly write the persisted preset state. */
export function persistStateEager(
	featureDir: string,
	next: PersistedPresetState,
): Promise<PersistedPresetState> {
	const path = join(featureDir, STATE_FILE);
	return mutateStateEager<PersistedPresetState>(path, (current) => ({ ...current, ...next }), {});
}

// Re-export for tests that want the schema directly. Marked internal.
export { PresetSchema };
