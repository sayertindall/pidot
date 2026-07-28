import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRuntimeState } from "./types";
import { shortObjective } from "./state";
import { formatContext, formatPercent } from "./usage";

export function updateTui(ctx: ExtensionContext, state?: GoalRuntimeState | null): void {
	if (!(ctx as any).hasUI) return;

	if (!state || state.status === "cleared") {
		(ctx as any).ui.setStatus("goal", undefined);
		(ctx as any).ui.setWidget("goal", undefined);
		return;
	}

	let status = "goal: ";
	if (state.status === "active") status += `active ${formatPercent(state.lastContextPercent)}`;
	else if (state.status === "budget_limited") status += `budget ${formatPercent(state.lastContextPercent)}`;
	else if (state.status === "handoff_started") status += `handoff ${state.sessionIndex}`;
	else if (state.status === "paused") status += "paused";
	else if (state.status === "complete") status += "complete";
	(ctx as any).ui.setStatus("goal", status);

	if (state.status === "complete") {
		(ctx as any).ui.setWidget("goal", undefined);
		return;
	}

	let next = "continuing automatically";
	if (state.status === "paused") next = "paused by user";
	if (state.status === "budget_limited") next = "waiting for goal_handoff";
	if (state.status === "handoff_started") next = "starting linked handoff session";

	(ctx as any).ui.setWidget("goal", [
		`Goal: ${shortObjective(state.objective, 90)}`,
		`Status: ${state.status.replace(/_/g, "-")} · context ${formatContext(state)} · session ${state.sessionIndex}`,
		`Next: ${next}`,
	]);
}
