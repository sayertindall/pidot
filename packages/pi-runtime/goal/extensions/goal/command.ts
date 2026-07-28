import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	appendState,
	getRuntimeState,
	isNonTerminal,
	reconstructState,
	setController,
	shortObjective,
} from "./state";
import { buildSummary } from "./prompts";
import {
	clearGoal,
	pauseGoal,
	requestManualHandoff,
	resumeGoal,
	sendVisibleSummary,
	startGoal,
} from "./tool";
import { updateTui } from "./widget";

export function registerCommand(pi: ExtensionAPI): void {
	(pi as any).registerCommand("goal", {
		description: "Run a long-running main-agent goal",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const input = args.trim();
			reconstructState(ctx);
			setController(ctx);

			if (!input) {
				const summary = buildSummary(ctx, getRuntimeState());
				sendVisibleSummary(pi, summary);
				updateTui(ctx);
				return;
			}

			const command = input.toLowerCase();
			if (command === "pause") {
				sendVisibleSummary(pi, pauseGoal(pi, ctx));
				return;
			}
			if (command === "resume") {
				sendVisibleSummary(pi, resumeGoal(pi, ctx));
				return;
			}
			if (command === "clear") {
				sendVisibleSummary(pi, clearGoal(pi, ctx));
				return;
			}
			if (command === "handoff") {
				sendVisibleSummary(pi, requestManualHandoff(pi, ctx));
				return;
			}

			const state = getRuntimeState();
			if (isNonTerminal(state)) {
				if (!(ctx as any).hasUI) {
					sendVisibleSummary(
						pi,
						"A goal is already active. Use `/goal clear` first, then start the new goal.",
					);
					return;
				}
				const replace = await (ctx as any).ui.confirm(
					"Replace active goal?",
					`Current goal: ${shortObjective(state!.objective, 100)}\n\nReplace it with: ${shortObjective(input, 100)}?`,
				);
				if (!replace) {
					(ctx as any).ui.notify("Goal unchanged.", "info");
					return;
				}
				appendState(pi, "cleared", {
					status: "cleared",
					currentSession: (ctx as any).sessionManager.getSessionFile(),
				});
			}

			startGoal(pi, ctx, input, ctx);
		},
	});
}
