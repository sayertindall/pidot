/**
 * review/ui.ts
 *
 * Status widget for an in-flight review. Render-throttled by pi's
 * setWidget; we keep the renderer cheap.
 */
import type { ReviewRecord, ReviewStatus } from "./types";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const STATUS_COLOR: Record<ReviewStatus, ThemeColor> = {
	idle: "dim",
	launching: "muted",
	running: "accent",
	done: "success",
	failed: "error",
	cancelled: "warning",
};

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function renderReviewWidget(
	record: ReviewRecord | null,
	now: number,
	theme: Theme,
): string[] {
	if (!record) return [];
	const elapsed = now - record.startedAt;
	const status = theme.fg(STATUS_COLOR[record.status], `[${record.status}]`);
	const target = describeTarget(record);
	const activity = record.lastToolName
		? ` · last: ${record.lastToolName}`
		: "";
	const tools = record.toolCount > 0 ? ` · ${record.toolCount} tool calls` : "";
	const line = `${status} ${target} · ${formatElapsed(elapsed)}${tools}${activity}`;
	return [theme.fg("dim" as ThemeColor, `◆ Review: ${line}`)];
}

function describeTarget(record: ReviewRecord): string {
	switch (record.target.type) {
		case "uncommitted":
			return "uncommitted changes";
		case "baseBranch":
			return `branch diff vs ${record.target.branch}`;
		case "commit":
			return `commit ${record.target.sha.slice(0, 7)}`;
		case "pullRequest":
			return `PR #${record.target.prNumber}`;
	}
}
