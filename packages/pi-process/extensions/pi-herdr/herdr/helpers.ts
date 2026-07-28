/**
 * pi-herdr/helpers.ts
 *
 * Pure utility functions used by the extension factory and
 * tool renderers. No ExtensionAPI dependency — everything here
 * takes its context as explicit arguments.
 */

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { AgentInfo, AgentStatus, HerdrJsonEnvelope, PaneInfo, PaneLayoutSnapshot, SplitDirection, TabInfo, WorkspaceInfo } from "./types";

export function parseHerdrError(output: string): string | null {
	const trimmed = output.trim();
	if (!trimmed) return null;
	try {
		const value = JSON.parse(trimmed) as HerdrJsonEnvelope;
		return value.error?.message || value.error?.code || trimmed;
	} catch {
		return trimmed;
	}
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (error instanceof Error && error.message === "Aborted");
}

export function formatOutput(output: string): string {
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return truncation.content;
	return `[Showing last ${truncation.outputLines} of ${truncation.totalLines} lines]\n${truncation.content}`;
}

export function chooseSplitDirection(layout: PaneLayoutSnapshot, paneId: string): SplitDirection {
	const pane = layout.panes.find((candidate) => candidate.pane_id === paneId);
	if (!pane) return "right";
	return pane.rect.width >= 80 && pane.rect.width >= pane.rect.height * 2 ? "right" : "down";
}

export function statusDot(theme: any, status: AgentStatus): string {
	switch (status) {
		case "blocked":
			return theme.fg("warning", "●");
		case "working":
			return theme.fg("accent", "●");
		case "done":
			return theme.fg("success", "●");
		case "idle":
			return theme.fg("muted", "○");
		default:
			return theme.fg("dim", "·");
	}
}

export function agentDisplayName(agent: AgentInfo): string {
	return agent.name || agent.display_agent || agent.agent || agent.pane_id;
}

export function summarizeAgent(agent: AgentInfo): string {
	const cwd = agent.cwd ? ` ${agent.cwd}` : "";
	return `${agentDisplayName(agent)}: [${agent.pane_id}] (${agent.agent_status}${agent.focused ? ", focused" : ""})${cwd}`;
}

export function summarizePane(pane: PaneInfo, currentPaneId?: string): string {
	const flags = [
		pane.pane_id === currentPaneId ? "current" : pane.focused ? "focused" : null,
		pane.agent,
		pane.agent_status !== "unknown" ? pane.agent_status : null,
	]
		.filter(Boolean)
		.join(", ");
	const cwd = pane.foreground_cwd || pane.cwd;
	return `${pane.label || pane.pane_id}: [${pane.pane_id}]${flags ? ` (${flags})` : ""}${cwd ? ` ${cwd}` : ""}`;
}

export function summarizeTab(tab: TabInfo): string {
	const flags = [tab.focused ? "focused" : null, tab.agent_status !== "unknown" ? tab.agent_status : null]
		.filter(Boolean)
		.join(", ");
	return `${tab.label}: [${tab.tab_id}]${flags ? ` (${flags})` : ""}`;
}

export function summarizeWorkspace(workspace: WorkspaceInfo): string {
	const flags = [
		workspace.focused ? "focused" : null,
		workspace.agent_status !== "unknown" ? workspace.agent_status : null,
	]
		.filter(Boolean)
		.join(", ");
	return `${workspace.label}: [${workspace.workspace_id}]${flags ? ` (${flags})` : ""}`;
}

export function renderToolCall(tool: string, args: Record<string, any>, theme: any, context: any) {
	const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	let text = theme.fg("toolTitle", theme.bold(`${tool} `));
	text += theme.fg("accent", args.action || "?");
	const target = args.target || args.pane || args.tab || args.workspace;
	if (target) text += theme.fg("muted", ` ${target}`);
	if (args.name) text += theme.fg("muted", ` ${args.name}`);
	if (args.kind) text += theme.fg("dim", ` › ${args.kind}`);
	if (args.direction) text += theme.fg("dim", ` › ${args.direction}`);
	if (args.command) text += theme.fg("dim", ` › ${args.command}`);
	if (args.prompt) text += theme.fg("dim", ` › ${args.prompt}`);
	if (args.match) text += theme.fg("dim", ` › ${args.match}`);
	component.setText(text);
	return component;
}

export function renderToolResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: any) {
	if (options.isPartial) return new Text(theme.fg("warning", "◌ waiting"), 0, 0);
	const details = result.details as Record<string, any> | undefined;
	const content = result.content?.[0];
	const rawText = content?.type === "text" ? content.text : "";
	if (!details) return new Text(rawText, 0, 0);

	if (details.agent) {
		const agent = details.agent as AgentInfo;
		return new Text(
			`${statusDot(theme, agent.agent_status)} ${theme.fg("accent", agentDisplayName(agent))} ${theme.fg("dim", agent.agent_status)}`,
			0,
			0,
		);
	}
	if (Array.isArray(details.agents)) {
		const agents = details.agents as AgentInfo[];
		return new Text(
			agents.length
				? agents
					.map(
						(agent) =>
							`${statusDot(theme, agent.agent_status)} ${theme.fg(agent.focused ? "accent" : "muted", agentDisplayName(agent))} ${theme.fg("dim", agent.agent_status)}`,
					)
					.join("\n")
				: theme.fg("dim", "no agents"),
			0,
			0,
		);
	}
	if (details.read) {
		let text = theme.fg("accent", `▤ ${details.target || details.pane}`);
		if (options.expanded && rawText) text += `\n${rawText.split("\n").slice(0, 40).map((line: string) => theme.fg("dim", line)).join("\n")}`;
		return new Text(text, 0, 0);
	}
	return new Text(theme.fg("success", `✓ ${details.action || "done"}`), 0, 0);
}
