/**
 * pi-herdr/types.ts
 *
 * Type definitions for the herdr extension. All interfaces
 * and type aliases live here; no runtime code.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type ReadSource = "visible" | "recent" | "recent-unwrapped" | "detection";
export type WaitOutputSource = Exclude<ReadSource, "detection">;
export type SplitDirection = "right" | "down";
export type OutputFormat = "text" | "ansi";

export interface WorkspaceInfo {
	workspace_id: string;
	label: string;
	focused: boolean;
	agent_status: AgentStatus;
}

export interface TabInfo {
	tab_id: string;
	workspace_id: string;
	label: string;
	focused: boolean;
	agent_status: AgentStatus;
}

export interface PaneInfo {
	pane_id: string;
	workspace_id: string;
	tab_id: string;
	focused: boolean;
	cwd?: string;
	foreground_cwd?: string;
	label?: string;
	agent?: string;
	agent_status: AgentStatus;
}

export interface AgentInfo {
	name?: string;
	agent?: string;
	display_agent?: string;
	agent_status: AgentStatus;
	workspace_id: string;
	tab_id: string;
	pane_id: string;
	focused: boolean;
	cwd?: string;
}

export interface PaneLayoutRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PaneLayoutSnapshot {
	workspace_id: string;
	tab_id: string;
	zoomed: boolean;
	focused_pane_id: string;
	area: PaneLayoutRect;
	panes: Array<{ pane_id: string; focused: boolean; rect: PaneLayoutRect }>;
	splits: Array<{ id: string; direction: SplitDirection; ratio: number; rect: PaneLayoutRect }>;
}

export interface HerdrJsonEnvelope {
	result?: unknown;
	error?: {
		code?: string;
		message?: string;
	};
}
