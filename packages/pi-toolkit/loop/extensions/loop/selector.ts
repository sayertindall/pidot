import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOOP_PRESETS, buildPrompt } from "./presets";
import type { LoopStateData } from "./types";

export async function showLoopSelector(ctx: ExtensionContext): Promise<LoopStateData | null> {
	const items: SelectItem[] = LOOP_PRESETS.map((preset) => ({
		value: preset.value,
		label: preset.label,
		description: preset.description,
	}));

	const selection = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Select a loop preset"))));

		const selectList = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});

		selectList.onSelect = (item: SelectItem) => done(item.value);
		selectList.onCancel = () => done(null);

		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", "Press enter to confirm or esc to cancel")));
		container.addChild(new DynamicBorder((str: string) => theme.fg("accent", str)));

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

	if (!selection) return null;

	switch (selection) {
		case "tests":
			return { active: true, mode: "tests", prompt: buildPrompt("tests") };
		case "self":
			return { active: true, mode: "self", prompt: buildPrompt("self") };
		case "custom": {
			const condition = await ctx.ui.editor("Enter loop breakout condition:", "");
			if (!condition?.trim()) return null;
			return {
				active: true,
				mode: "custom",
				condition: condition.trim(),
				prompt: buildPrompt("custom", condition.trim()),
			};
		}
		default:
			return null;
	}
}
