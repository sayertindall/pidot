import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ContextUsage } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalRuntimeState } from "./types";
import {
	appendState,
	getController,
	getRuntimeState,
	isNonTerminal,
	newGoalId,
	reconstructState,
	setController,
	setRuntimeState,
	shortObjective,
	updateUsage,
} from "./state";
import {
	buildSummary,
	buildInitialPrompt,
	buildContinuationPrompt,
	buildBudgetPrompt,
	buildManualHandoffPrompt,
} from "./prompts";
import { startDeferredHandoff } from "./handoff";
import { updateTui } from "./widget";
import { usageFields } from "./usage";

const CONTINUE_MESSAGE_TYPE = "pi-goal:continue";
const BUDGET_MESSAGE_TYPE = "pi-goal:budget-limit";
const HANDOFF_MESSAGE_TYPE = "pi-goal:handoff";
const SUMMARY_MESSAGE_TYPE = "pi-goal:summary";
const DEFAULT_CONTEXT_THRESHOLD_PERCENT = 95;

function sendHidden(pi: ExtensionAPI, customType: string, content: string): void {
	(pi as any).sendMessage(
		{
			customType,
			content,
			display: false,
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	);
}

export function sendVisibleSummary(pi: ExtensionAPI, content: string): void {
	(pi as any).sendMessage({ customType: SUMMARY_MESSAGE_TYPE, content, display: true });
}

export function queueInitialContinuation(pi: ExtensionAPI, state: GoalRuntimeState): void {
	state.continuationInFlight = true;
	sendHidden(pi, CONTINUE_MESSAGE_TYPE, buildInitialPrompt(state.objective));
}

export function queueContinuation(pi: ExtensionAPI, state: GoalRuntimeState): void {
	state.continuationInFlight = true;
	appendState(pi, "continued", {
		status: "active",
		currentSession: state.currentSession,
		...usageFields(undefined, state),
	});
	sendHidden(pi, CONTINUE_MESSAGE_TYPE, buildContinuationPrompt(state));
}

export function requestBudgetHandoff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: GoalRuntimeState,
	usage: ContextUsage | undefined,
): void {
	updateUsage(state, usage);
	state.status = "budget_limited";
	state.handoffInFlight = true;
	state.continuationInFlight = false;
	appendState(pi, "budget_limited", {
		status: "budget_limited",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
		...usageFields(usage, state),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal context budget reached. Requesting handoff.", "warning");
	sendHidden(pi, BUDGET_MESSAGE_TYPE, buildBudgetPrompt(state));
}

export function startGoal(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	objective: string,
	commandCtx?: ExtensionCommandContext,
): GoalRuntimeState {
	const usage = (ctx as any).getContextUsage();
	const currentSession = (ctx as any).sessionManager.getSessionFile();
	const goalId = newGoalId();

	const state: GoalRuntimeState = {
		goalId,
		objective,
		status: "active",
		thresholdPercent: DEFAULT_CONTEXT_THRESHOLD_PERCENT,
		sessionIndex: 1,
		sessions: currentSession ? [currentSession] : [],
		currentSession,
		lastContextPercent: usage?.percent ?? null,
		lastContextTokens: usage?.tokens ?? null,
		contextWindow: usage?.contextWindow ?? null,
		continuationInFlight: false,
		handoffInFlight: false,
	};

	setRuntimeState(state);
	if (commandCtx) setController(commandCtx);

	appendState(pi, "created", {
		goalId,
		objective,
		status: "active",
		thresholdPercent: DEFAULT_CONTEXT_THRESHOLD_PERCENT,
		sessionIndex: 1,
		currentSession,
		...usageFields(usage, state),
	});

	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal started.", "info");

	if (usage?.percent !== null && usage?.percent !== undefined && usage.percent >= DEFAULT_CONTEXT_THRESHOLD_PERCENT) {
		requestBudgetHandoff(pi, ctx, state, usage);
	} else {
		queueInitialContinuation(pi, state);
	}

	return state;
}

export function pauseGoal(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state || state.status === "cleared") return "No active goal to pause.";
	state.status = "paused";
	state.continuationInFlight = false;
	state.handoffInFlight = false;
	appendState(pi, "status_changed", {
		status: "paused",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal paused.", "info");
	return "Goal paused.";
}

export function resumeGoal(pi: ExtensionAPI, ctx: ExtensionCommandContext): string {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state || state.status === "cleared") return "No goal to resume.";
	if (state.status === "complete") return "Goal is already complete.";
	setController(ctx);
	const usage = (ctx as any).getContextUsage();
	updateUsage(state, usage);
	state.status = "active";
	state.continuationInFlight = false;
	state.handoffInFlight = false;
	appendState(pi, "status_changed", {
		status: "active",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
		...usageFields(usage, state),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal resumed.", "info");
	if (usage?.percent !== null && usage?.percent !== undefined && usage.percent >= state.thresholdPercent) {
		requestBudgetHandoff(pi, ctx, state, usage);
	} else {
		queueContinuation(pi, state);
	}
	return "Goal resumed.";
}

export function clearGoal(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state) return "No goal to clear.";
	state.status = "cleared";
	state.continuationInFlight = false;
	state.handoffInFlight = false;
	appendState(pi, "cleared", {
		status: "cleared",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal cleared.", "info");
	return "Goal cleared.";
}

export function requestManualHandoff(pi: ExtensionAPI, ctx: ExtensionCommandContext): string {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state || state.status === "cleared" || state.status === "complete") return "No active goal to hand off.";
	setController(ctx);
	const usage = (ctx as any).getContextUsage();
	updateUsage(state, usage);
	state.status = "handoff_started";
	state.handoffInFlight = true;
	state.continuationInFlight = false;
	appendState(pi, "handoff_requested", {
		status: "handoff_started",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
		...usageFields(usage, state),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal handoff requested.", "info");
	sendHidden(pi, HANDOFF_MESSAGE_TYPE, buildManualHandoffPrompt(state));
	return "Goal handoff requested.";
}

export function latestAssistantError(ctx: ExtensionContext): string | undefined {
	const branch = (ctx as any).sessionManager.getBranch() as any[];
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		if (entry.message.stopReason !== "error") return undefined;
		return entry.message.errorMessage || "Unknown agent error.";
	}
	return undefined;
}

export function pauseAfterAgentError(pi: ExtensionAPI, ctx: ExtensionContext, error: string): void {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state || state.status !== "active") return;

	const usage = (ctx as any).getContextUsage();
	updateUsage(state, usage);
	state.status = "paused";
	state.continuationInFlight = false;
	state.handoffInFlight = false;
	appendState(pi, "status_changed", {
		status: "paused",
		currentSession: (ctx as any).sessionManager.getSessionFile(),
		...usageFields(usage, state),
	});
	updateTui(ctx, state);
	if ((ctx as any).hasUI) (ctx as any).ui.notify(`Goal paused after agent error: ${shortObjective(error, 120)}`, "error");
}

export function maybeQueueNextStep(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const state = getRuntimeState() ?? reconstructState(ctx);
	if (!state || state.status !== "active") return;
	if (state.continuationInFlight || state.handoffInFlight || (ctx as any).hasPendingMessages()) return;

	const usage = (ctx as any).getContextUsage();
	updateUsage(state, usage);
	updateTui(ctx, state);

	if (usage?.percent !== null && usage?.percent !== undefined && usage.percent >= state.thresholdPercent) {
		requestBudgetHandoff(pi, ctx, state, usage);
		return;
	}

	queueContinuation(pi, state);
}

// Tool registrations

import type { ExtensionAPI as ExtAPI } from "@earendil-works/pi-coding-agent";

export function registerTools(pi: ExtAPI): void {
	(pi as any).registerTool({
		name: "get_goal",
		label: "Get Goal",
		description: "Return the current active pi-goal state, context usage, and session lineage.",
		parameters: Type.Object({}),
		async execute(_toolCallId: any, _params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
			reconstructState(ctx);
			const summary = buildSummary(ctx, getRuntimeState());
			return {
				content: [{ type: "text", text: summary }],
				details: {
					state: getRuntimeState(),
					contextUsage: (ctx as any).getContextUsage(),
					controllerAvailable: !!getController(),
				},
			};
		},
	});

	(pi as any).registerTool({
		name: "create_goal",
		label: "Create Goal",
		description:
			"Create one active long-running goal only when the user explicitly asked to start goal mode. Prefer the /goal command because automatic new-session handoff needs its command context.",
		parameters: Type.Object({
			objective: Type.String({ description: "The explicit user objective for the long-running goal." }),
		}),
		async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
			reconstructState(ctx);
			if (isNonTerminal(getRuntimeState())) {
				return {
					content: [
						{
							type: "text",
							text: "A goal is already active. Ask the user to run /goal clear or /goal <new objective> to replace it.",
						},
					],
					details: { state: getRuntimeState() },
				};
			}
			const state = startGoal(pi, ctx, params.objective);
			return {
				content: [
					{
						type: "text",
						text: "Goal created. Continuing automatically. Automatic linked-session handoff will require `/goal resume` unless the goal was started from `/goal <objective>`.",
					},
				],
				details: { state, controllerAvailable: !!getController() },
			};
		},
	});

	(pi as any).registerTool({
		name: "update_goal",
		label: "Update Goal",
		description:
			"Mark the active goal complete. Use only when the objective is actually achieved and no required work remains.",
		parameters: Type.Object({
			status: StringEnum(["complete"] as const, {
				description: "Set to complete only when the active goal is actually achieved.",
			}) as any,
		}),
		async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
			reconstructState(ctx);
			const state = getRuntimeState();
			if (!state || state.status === "cleared") {
				return { content: [{ type: "text", text: "No active goal to complete." }], details: {} };
			}
			if (params.status !== "complete") {
				return {
					content: [{ type: "text", text: 'update_goal only accepts status "complete".' }],
					details: { state },
				};
			}

			const usage = (ctx as any).getContextUsage();
			updateUsage(state, usage);
			state.status = "complete";
			state.continuationInFlight = false;
			state.handoffInFlight = false;
			appendState(pi, "completed", {
				status: "complete",
				currentSession: (ctx as any).sessionManager.getSessionFile(),
				...usageFields(usage, state),
			});
			updateTui(ctx, state);
			if ((ctx as any).hasUI) (ctx as any).ui.notify("Goal completed.", "info");

			return {
				content: [{ type: "text", text: `Goal complete: ${state.objective}` }],
				details: { state, contextUsage: usage },
				terminate: true,
			};
		},
	});

	(pi as any).registerTool({
		name: "goal_handoff",
		label: "Goal Handoff",
		description:
			"Prepare and start an automatic handoff for the active goal. Use only when pi-goal says the context budget is reached or the user explicitly requested /goal handoff. The prompt must be self-contained because the next session will not have this conversation history.",
		parameters: Type.Object({
			prompt: Type.String({
				description:
					"Complete handoff prompt for the next session. Include objective, completed work, decisions, files, commands, blockers, and exact next action.",
			}),
		}),
		async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: ExtensionContext) {
			reconstructState(ctx);
			const state = getRuntimeState();
			if (!state || state.status === "cleared" || state.status === "complete") {
				return { content: [{ type: "text", text: "No active goal to hand off." }], details: {} };
			}
			if (
				state.status !== "budget_limited" &&
				state.status !== "handoff_started" &&
				!state.handoffInFlight
			) {
				return {
					content: [
						{
							type: "text",
							text: "goal_handoff is only valid after the context budget is reached or `/goal handoff` is requested.",
						},
					],
					details: { state },
				};
			}

			const usage = (ctx as any).getContextUsage();
			updateUsage(state, usage);
			const controller = getController();
			appendState(pi, "handoff_requested", {
				status: "handoff_started",
				currentSession: (ctx as any).sessionManager.getSessionFile(),
				handoffPrompt: params.prompt,
				...usageFields(usage, state),
			});
			state.status = "handoff_started";
			state.handoffInFlight = true;
			state.continuationInFlight = false;
			updateTui(ctx, state);

			if (!controller) {
				return {
					content: [
						{
							type: "text",
							text: "Goal handoff prompt saved, but automatic session switching requires starting or resuming the goal with `/goal <objective>` or `/goal resume`.",
						},
					],
					details: { state, handoffPrompt: params.prompt, controllerAvailable: false },
					terminate: true,
				};
			}

			const currentSessionFile = (ctx as any).sessionManager.getSessionFile();
			startDeferredHandoff({
				controller,
				objective: state.objective,
				goalId: state.goalId,
				thresholdPercent: state.thresholdPercent,
				nextSessionIndex: state.sessionIndex + 1,
				currentSessionFile,
				handoffPrompt: params.prompt,
			});

			return {
				content: [{ type: "text", text: "Goal handoff captured. Starting a linked new session." }],
				details: { state, handoffPrompt: params.prompt, controllerAvailable: true },
				terminate: true,
			};
		},
	});
}
