/**
 * Preset extension entry point.
 *
 * Wires together the concern modules: types/schemas/state/runtime/ui/commands.
 * The entry point is registry-only — all logic lives in the concern files.
 *
 * Lifecycle:
 *   1. `session_start` — load presets.json, validate, apply --preset flag
 *      if present, otherwise restore persisted state.
 *   2. `before_agent_start` — inject active preset's instructions into the
 *      system prompt.
 *   3. `/preset` command and `Ctrl+Shift+U` shortcut for in-session changes.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { getFeatureDir } from "../_shared/paths";
import { loadPersistedState, loadPresets } from "./state";
import { setActivePresetWidget } from "./ui";
import { registerPresetCommand, type PresetRuntime } from "./commands";
import type { Preset, PresetState } from "./types";
import { nextCycleName } from "./runtime";

const FEATURE = "preset";

export default function presetExtension(pi: ExtensionAPI): void {
	const featureDir = getFeatureDir(FEATURE);
	let presets: Record<string, Preset> = {};
	const presetState: PresetState = { activeName: undefined, original: undefined };
	const runtime: PresetRuntime = { state: presetState };

	pi.registerFlag("preset", {
		description: "Preset to activate on session start",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		// 1. Load presets
		const loaded = loadPresets(featureDir);
		presets = loaded.presets;
		for (const d of loaded.diagnostics) {
			if (ctx.hasUI) ctx.ui.notify(`Preset: ${d.message}`, "warning");
		}

		// 2. Apply --preset flag (wins over persisted state)
		const flag = pi.getFlag("preset");
		if (typeof flag === "string" && flag) {
			if (presets[flag]) {
				presetState.activeName = flag;
				setActivePresetWidget(ctx, flag);
			} else if (ctx.hasUI) {
				ctx.ui.notify(`Unknown preset "${flag}"`, "warning");
			}
		} else {
			// 3. Otherwise restore persisted state
			const persisted = loadPersistedState(featureDir);
			if (persisted.active_name && presets[persisted.active_name]) {
				presetState.activeName = persisted.active_name;
				setActivePresetWidget(ctx, persisted.active_name);
			}
		}

		// 4. Bind commands and shortcut
		const deps = { pi, presets, featureDir };
		registerPresetCommand(pi, deps, runtime);
		bindCycleShortcut(pi, ctx, deps, runtime);
	});

	pi.on("before_agent_start", (event) => {
		if (!presetState.activeName) return undefined;
		const preset = presets[presetState.activeName];
		if (!preset?.instructions) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${preset.instructions}` };
	});
}

function bindCycleShortcut(
	pi: ExtensionAPI,
	_ctx: ExtensionContext,
	deps: { pi: ExtensionAPI; presets: Record<string, Preset>; featureDir: string },
	runtime: PresetRuntime,
): void {
	pi.registerShortcut(Key.ctrlShift("u"), {
		description: "Cycle presets",
		handler: async (ctx) => {
			const names = Object.keys(deps.presets).sort();
			if (names.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("No presets defined.", "warning");
				return;
			}
			const next = nextCycleName(runtime.state.activeName, names);
			if (next === "(none)") {
				runtime.state.activeName = undefined;
				setActivePresetWidget(ctx, undefined);
				if (ctx.hasUI) ctx.ui.notify("Preset cleared", "info");
				return;
			}
			runtime.state.activeName = next;
			setActivePresetWidget(ctx, next);
			if (ctx.hasUI) ctx.ui.notify(`Preset "${next}" activated`, "info");
		},
	});
}
