/**
 * Safety config I/O.
 *
 * Stateless: read once at `session_start`, cached in memory, no
 * per-tool-call disk hit. Reload picks up file edits.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { quarantineCorrupt } from "../_shared/io";
import { SafetyConfigSchema } from "./schemas";
import { EMPTY_SAFETY_CONFIG, type SafetyConfig } from "./types";

/** Read safety.json from `featureDir`, or return the empty default. */
export function readSafetyConfig(featureDir: string): SafetyConfig {
	const path = join(featureDir, "safety.json");
	if (!existsSync(path)) return EMPTY_SAFETY_CONFIG;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (!Value.Check(SafetyConfigSchema, raw)) {
			// The shape is wrong but the file is parseable; don't quarantine
			// (the user may have been mid-edit). Fall back to empty and warn.
			return EMPTY_SAFETY_CONFIG;
		}
		return raw as SafetyConfig;
	} catch {
		quarantineCorrupt(path);
		return EMPTY_SAFETY_CONFIG;
	}
}
