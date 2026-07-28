/**
 * pi-toolkit-tilldone — widget
 *
 * Renders the task list widget below the editor and status line.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TillDoneState } from "./types";

const STATUS_ICON: Record<string, string> = {
	idle: "( )",
	inprogress: "(*)",
	done: "(x)",
};

/**
 * Update the tilldone widget and status line from the current state.
 * Call this after every state change that should be reflected in the UI.
 */
export function updateWidget(ctx: ExtensionContext, state: TillDoneState): void {
	if (!state.enabled) {
		ctx.ui.setStatus("tilldone", undefined);
		ctx.ui.setWidget("tilldone-current", undefined);
		return;
	}

	// Status line: compact progress
	const done = state.tasks.filter((t) => t.status === "done").length;
	const total = state.tasks.length;

	if (total === 0) {
		ctx.ui.setStatus("tilldone", "TASKS: none");
	} else if (done === total) {
		ctx.ui.setStatus("tilldone", `TASKS: ${done}/${total} done ✓`);
	} else {
		ctx.ui.setStatus("tilldone", `TASKS: ${done}/${total}`);
	}

	// Widget: show current in-progress task below editor
	const current = state.tasks.find((t) => t.status === "inprogress");
	if (!current) {
		ctx.ui.setWidget("tilldone-current", undefined);
		return;
	}

	ctx.ui.setWidget(
		"tilldone-current",
		(_tui, _theme) => ({
			render(width: number): string[] {
				// Re-read the task from the closure — it's captured per render.
				const cur = state.tasks.find((t) => t.status === "inprogress");
				if (!cur) return [];
				const icon = STATUS_ICON[cur.status] ?? "( )";
				const line = `>> WORKING ON #${cur.id} - ${icon} ${cur.text}`;
				return [truncateToWidth(line, width)];
			},
			invalidate() {},
		}),
		{ placement: "belowEditor" },
	);
}

/** Format a task list for system prompt injection. */
export function formatTaskList(state: TillDoneState): string {
	if (state.tasks.length === 0) return "No tasks defined.";
	return state.tasks
		.map((t) => {
			const icon = STATUS_ICON[t.status] ?? "( )";
			return `  ${icon} #${t.id} (${t.status}): ${t.text}`;
		})
		.join("\n");
}
