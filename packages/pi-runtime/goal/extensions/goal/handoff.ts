import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GoalStateEntry } from "./types";
import { goalSessionName, setController, STATE_ENTRY } from "./state";

export function buildKickoffPrompt(
	objective: string,
	handoffPrompt: string,
	parentSession: string | undefined,
): string {
	const parent = parentSession
		? `Parent session: ${parentSession}\nUse session_query("${parentSession}", "<your question>") if you need more detail from the previous session.\n\n`
		: "";
	return [
		"Continue this active goal from the previous session.",
		"",
		parent.trimEnd(),
		parent ? "" : undefined,
		"Goal:",
		objective,
		"",
		"Handoff from previous session:",
		handoffPrompt,
		"",
		"Continue from the exact next action. If the goal is complete, call update_goal with status \"complete\". Otherwise keep working until completion or the next context-budget handoff.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export function appendGoalStateToSessionManager(
	sessionManager: any,
	entry: GoalStateEntry,
	sessionName: string,
): void {
	if (typeof sessionManager.appendCustomEntry === "function") {
		sessionManager.appendCustomEntry(STATE_ENTRY, entry);
	}
	if (typeof sessionManager.appendSessionInfo === "function") {
		sessionManager.appendSessionInfo(sessionName);
	}
}

export function startDeferredHandoff(params: {
	controller: ExtensionCommandContext;
	objective: string;
	goalId: string;
	thresholdPercent: number;
	nextSessionIndex: number;
	currentSessionFile: string | undefined;
	handoffPrompt: string;
}): void {
	setTimeout(async () => {
		try {
			const kickoffPrompt = buildKickoffPrompt(params.objective, params.handoffPrompt, params.currentSessionFile);
			const result = await (params.controller as any).newSession({
				parentSession: params.currentSessionFile,
				setup: async (sessionManager: any) => {
					const nextSessionFile =
						typeof sessionManager.getSessionFile === "function" ? sessionManager.getSessionFile() : undefined;
					appendGoalStateToSessionManager(
						sessionManager,
						{
							version: 1,
							event: "handoff_completed",
							goalId: params.goalId,
							objective: params.objective,
							status: "active",
							thresholdPercent: params.thresholdPercent,
							sessionIndex: params.nextSessionIndex,
							parentSession: params.currentSessionFile,
							currentSession: nextSessionFile,
							handoffPrompt: params.handoffPrompt,
							contextPercent: null,
							contextTokens: null,
							contextWindow: null,
							timestamp: Date.now(),
						},
						goalSessionName(params.objective, params.nextSessionIndex),
					);
				},
				withSession: async (nextCtx: any) => {
					setController(nextCtx);
					if (nextCtx.hasUI) nextCtx.ui.notify("Goal handoff session started.", "info");
					await nextCtx.sendUserMessage(kickoffPrompt);
				},
			});

			if (result.cancelled) {
				console.error("pi-goal handoff was cancelled by session switch guard.");
			}
		} catch (error) {
			console.error("pi-goal failed to start handoff session:", error);
		}
	}, 0);
}
