/**
 * /preset command handler.
 *
 * Subcommands (one slash root, four verbs — principle 8):
 *   /preset list                   — show all presets
 *   /preset show <name>            — show preset details
 *   /preset activate <name>        — apply a preset
 *   /preset cycle                  — cycle through presets
 *
 * No arg → show selector UI (preserves the original UX).
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import { applyPreset, clearPreset, nextCycleName, type ThinkingLevel } from "./runtime";
import { describePreset, notifyPresetChange, setActivePresetWidget } from "./ui";
import type { Preset, PresetState } from "./types";
import { persistStateEager } from "./state";

export interface PresetDeps {
	pi: ExtensionAPI;
	presets: Record<string, Preset>;
	featureDir: string;
}

export interface PresetRuntime {
	state: PresetState;
}

export type PresetCommand =
	| { verb: "list" }
	| { verb: "show"; name: string }
	| { verb: "activate"; name: string }
	| { verb: "cycle" }
	| { verb: "select" };

export function parsePresetCommand(args: string): PresetCommand {
	const trimmed = args.trim();
	if (trimmed === "") return { verb: "select" };
	const parts = trimmed.split(/\s+/);
	const [verb, ...rest] = parts;
	if (verb === "list") return { verb: "list" };
	if (verb === "show" && rest[0]) return { verb: "show", name: rest[0] };
	if (verb === "activate" && rest[0]) return { verb: "activate", name: rest[0] };
	if (verb === "cycle") return { verb: "cycle" };
	if (rest.length === 0 && verb) return { verb: "activate", name: verb };
	return { verb: "activate", name: trimmed };
}

function buildApplyDeps(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	return {
		pi,
		ctx,
		currentModel: ctx.model as unknown as import("./runtime").AnyModel | undefined,
		currentThinking: pi.getThinkingLevel() as ThinkingLevel,
		currentTools: pi.getActiveTools(),
	};
}

async function persistActiveName(deps: PresetDeps, name: string | undefined): Promise<void> {
	await persistStateEager(deps.featureDir, { active_name: name });
}

async function doActivate(
	deps: PresetDeps,
	runtime: PresetRuntime,
	name: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const preset = deps.presets[name];
	if (!preset) {
		if (ctx.hasUI) ctx.ui.notify(`Unknown preset "${name}"`, "error");
		return;
	}
	const applyDeps = buildApplyDeps(deps.pi, ctx);
	const result = await applyPreset(name, preset, applyDeps, runtime.state.original);
	runtime.state.activeName = name;
	if (!runtime.state.original) {
		runtime.state.original = {
			model: applyDeps.currentModel,
			thinkingLevel: applyDeps.currentThinking,
			tools: applyDeps.currentTools,
		};
	}
	await persistActiveName(deps, name);
	setActivePresetWidget(ctx, name);
	notifyPresetChange(ctx, name, result.warnings);
}

async function doClear(
	deps: PresetDeps,
	runtime: PresetRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const applyDeps = buildApplyDeps(deps.pi, ctx);
	clearPreset(runtime.state.original, applyDeps);
	runtime.state.activeName = undefined;
	await persistActiveName(deps, undefined);
	setActivePresetWidget(ctx, undefined);
	notifyPresetChange(ctx, undefined);
}

async function doCycle(
	deps: PresetDeps,
	runtime: PresetRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const names = Object.keys(deps.presets).sort();
	if (names.length === 0) {
		if (ctx.hasUI) ctx.ui.notify("No presets defined.", "warning");
		return;
	}
	const next = nextCycleName(runtime.state.activeName, names);
	if (next === "(none)") {
		await doClear(deps, runtime, ctx);
	} else {
		await doActivate(deps, runtime, next, ctx);
	}
}

function doList(deps: PresetDeps, runtime: PresetRuntime, ctx: ExtensionCommandContext): void {
	const lines = formatPresetList(deps.presets, runtime.state.activeName);
	if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
}

export function formatPresetList(presets: Record<string, Preset>, active: string | undefined): string[] {
	const names = Object.keys(presets).sort();
	if (names.length === 0) return ["(no presets defined)"];
	return names.map((name) => {
		const marker = name === active ? "*" : " ";
		const preset = presets[name];
		return `${marker} ${name} — ${preset ? describePreset(preset) : ""}`;
	});
}

function doShow(deps: PresetDeps, name: string, ctx: ExtensionCommandContext): void {
	const preset = deps.presets[name];
	if (!preset) {
		if (ctx.hasUI) ctx.ui.notify(`Unknown preset "${name}"`, "error");
		return;
	}
	const lines = [
		`${name}: ${describePreset(preset)}`,
		preset.instructions ? `instructions: ${preset.instructions}` : "instructions: (none)",
	];
	if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
}

async function showSelector(
	deps: PresetDeps,
	runtime: PresetRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("No UI available. Use `/preset list` to see names.", "warning");
		return;
	}
	const presetNames = Object.keys(deps.presets).sort();
	if (presetNames.length === 0) {
		ctx.ui.notify("No presets defined.", "warning");
		return;
	}

	const items: SelectItem[] = [
		{ value: "(none)", label: "(none)", description: "Clear active preset" },
		...presetNames.map<SelectItem>((name) => {
			const p = deps.presets[name];
			const isActive = name === runtime.state.activeName;
			return {
				value: name,
				label: isActive ? `${name} (active)` : name,
				description: p ? describePreset(p) : "",
			};
		}),
	];

	const result = await ctx.ui.custom<string | null>((tui, theme: Theme, _kb, done) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));
		const selectList = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	if (result === null) return;
	if (result === "(none)") {
		await doClear(deps, runtime, ctx);
		return;
	}
	await doActivate(deps, runtime, result, ctx);
}

export function registerPresetCommand(
	pi: ExtensionAPI,
	deps: PresetDeps,
	runtime: PresetRuntime,
): void {
	pi.registerCommand("preset", {
		description: "Manage presets. Subcommands: list, show <name>, activate <name>, cycle",
		handler: async (args, ctx) => {
			const cmd = parsePresetCommand(args ?? "");
			switch (cmd.verb) {
				case "list":
					return doList(deps, runtime, ctx);
				case "show":
					return doShow(deps, cmd.name, ctx);
				case "activate":
					return doActivate(deps, runtime, cmd.name, ctx);
				case "cycle":
					return doCycle(deps, runtime, ctx);
				case "select":
					return showSelector(deps, runtime, ctx);
			}
		},
	});
}
