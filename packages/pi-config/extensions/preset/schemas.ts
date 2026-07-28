/**
 * TypeBox schemas for the preset extension.
 *
 * `PresetSchema` validates a single preset entry. The full presets.json
 * is a record of those; validation is done per-entry in the loader so
 * one bad preset doesn't poison the rest.
 *
 * `PersistedPresetStateSchema` validates the on-disk state file.
 */

import { Type } from "typebox";
import { NonEmptyString } from "../_shared/schemas";

const ThinkingLevelLiteral = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);

/** A single preset entry (snake_case keys; matches the on-disk file). */
export const PresetSchema = Type.Object({
	provider: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	thinking_level: Type.Optional(ThinkingLevelLiteral),
	tools: Type.Optional(Type.Array(Type.String())),
	instructions: Type.Optional(Type.String()),
});

/** Top-level shape of presets.json: a record of named presets. */
export const PresetsFileSchema = Type.Record(NonEmptyString, PresetSchema);

/** The on-disk persisted state. */
export const PersistedPresetStateSchema = Type.Object({
	active_name: Type.Optional(Type.String()),
});
