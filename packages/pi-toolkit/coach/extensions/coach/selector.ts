import {
	Container,
	SelectList,
	Text,
	type Component,
	type SelectItem,
	type TUI,
} from "@earendil-works/pi-tui";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type { CoachScope } from "./types";

export class CoachModePicker implements Component {
	private readonly container: Container;
	private readonly selectList: SelectList;

	constructor(tui: TUI, theme: Theme, onDone: (scope: CoachScope | null) => void) {
		const items: SelectItem[] = [
			{
				value: "current",
				label: "Current session",
				description: "Analyze this live conversation only",
			},
			{
				value: "all",
				label: "All sessions in this working directory",
				description: "Deep analysis of all session history (This will take longer and use tokens)",
			},
		];

		this.container = new Container();
		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.container.addChild(
			new Text(theme.fg("accent", theme.bold("Coach scope")) + theme.fg("dim", "  (Esc to cancel)"), 1, 0),
		);
		this.container.addChild(
			new Text(theme.fg("muted", "Choose what /coach should analyze. Results are LLM-generated."), 1, 0),
		);
		this.container.addChild(new Text("", 1, 0));

		this.selectList = new SelectList(items, Math.min(items.length + 1, 8), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		this.selectList.onSelect = (item) => onDone(item.value as CoachScope);
		this.selectList.onCancel = () => onDone(null);

		this.container.addChild(this.selectList);
		this.container.addChild(new Text("", 1, 0));
		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		void tui;
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	handleInput(data: string): void {
		this.selectList.handleInput?.(data);
	}

	invalidate(): void {
		this.container.invalidate();
	}
}
