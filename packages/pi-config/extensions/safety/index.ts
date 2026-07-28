/**
 * Safety extension entry point.
 *
 * Stateless beyond the cached config. Reads safety.json at
 * `session_start` (and on `/safety reload`), registers the tool_call
 * hook and the `/safety` command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getFeatureDir } from "../_shared/paths";
import { readSafetyConfig } from "./state";
import { bindToolCallHook } from "./runtime";
import { registerSafetyCommand } from "./commands";

const FEATURE = "safety";

export default function safetyExtension(pi: ExtensionAPI): void {
	const featureDir = getFeatureDir(FEATURE);
	let cached = readSafetyConfig(featureDir);

	const getConfig = (): typeof cached => cached;
	const reload = (): typeof cached => {
		cached = readSafetyConfig(featureDir);
		return cached;
	};

	pi.on("session_start", () => {
		cached = readSafetyConfig(featureDir);
	});

	bindToolCallHook(pi, getConfig);
	registerSafetyCommand(pi, getConfig, reload);
}
