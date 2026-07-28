import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalRuntimeState } from "./types";
import { shortObjective, getController } from "./state";
import { formatContext } from "./usage";

export function buildInitialPrompt(objective: string): string {
	return [
		"Active goal started.",
		"",
		"Objective:",
		objective,
		"",
		"Work toward this objective. Before declaring completion, audit the actual current state: files, command output, tests, and other concrete evidence. If the goal is achieved and no required work remains, call update_goal with status \"complete\". If not complete, continue with the next concrete action.",
	].join("\n");
}

export function buildContinuationPrompt(state: GoalRuntimeState): string {
	return [
		"Continue the active goal.",
		"",
		"Objective:",
		state.objective,
		"",
		`Context usage: ${formatContext(state)}.`,
		"Do not repeat completed work. Use the conversation history and concrete evidence. Before declaring completion, audit files, command output, tests, and other concrete state. Call update_goal with status \"complete\" only when the objective is actually complete and no required work remains. Otherwise continue with the next concrete action.",
	].join("\n");
}

export function buildBudgetPrompt(state: GoalRuntimeState): string {
	return [
		`The active goal has reached the context budget limit at ${formatContext(state)} of the model context window.`,
		"",
		"Do not start new substantive work in this session. Prepare a complete handoff for the next session and call goal_handoff.",
		"",
		"The handoff must include:",
		"- The active objective.",
		"- What has been completed.",
		"- Important decisions and constraints.",
		"- Files and commands that matter.",
		"- Known blockers or risks.",
		"- The exact next action the next session should take.",
		"",
		"Do not call update_goal unless the goal is actually complete.",
	].join("\n");
}

export function buildManualHandoffPrompt(state: GoalRuntimeState): string {
	return [
		"The user requested a handoff for the active goal now.",
		"",
		"Do not start new substantive work in this session. Prepare a complete handoff for the next session and call goal_handoff.",
		"",
		"Objective:",
		state.objective,
		"",
		"The handoff must include completed work, decisions and constraints, files and commands that matter, blockers or risks, and the exact next action.",
	].join("\n");
}

export function buildSummary(ctx: ExtensionContext, state?: GoalRuntimeState | null): string {
	const usage = ctx.getContextUsage() as any;
	const current = state ?? null;
	if (current && usage) {
		current.lastContextPercent = usage.percent ?? null;
		current.lastContextTokens = usage.tokens ?? null;
		current.contextWindow = usage.contextWindow ?? null;
	}

	if (!current || current.status === "cleared") {
		return "No active goal. Start one with `/goal <objective>`.";
	}

	const lines = [
		`Goal: ${current.objective}`,
		`Status: ${current.status.replace(/_/g, "-")}`,
		`Context: ${formatContext(current)}`,
		`Threshold: ${current.thresholdPercent}%`,
		`Session index: ${current.sessionIndex}`,
	];

	if (current.currentSession) lines.push(`Current session: ${current.currentSession}`);
	if (current.parentSession) lines.push(`Parent session: ${current.parentSession}`);
	if (current.sessions.length > 0) lines.push(`Lineage: ${current.sessions.join(" -> ")}`);
	if (current.lastHandoffPrompt) lines.push(`Last handoff: ${shortObjective(current.lastHandoffPrompt, 160)}`);

	lines.push("", "Controls: `/goal pause`, `/goal resume`, `/goal handoff`, `/goal clear`.");
	if (!getController()) {
		lines.push("Automatic new-session handoff controller is not captured. Run `/goal resume` to restore it.");
	}
	return lines.join("\n");
}
