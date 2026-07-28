/**
 * shell/widget.ts
 *
 * "bg-sessions" widget. Renders below the editor, showing active run records
 * (running or interrupted). Uses setWidget directly on every state change
 * (not tuiRef.requestRender) to guarantee reliable re-rendering.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DispatchCoordinator } from "./coordinator";
import type { SessionRegistry } from "./session";
import { getIndex } from "./state";
import { formatDuration } from "./types";

export function setupBackgroundWidget(
	ctx: ExtensionContext,
	registry: SessionRegistry,
	coordinator: DispatchCoordinator,
): (() => void) | null {
	if (!ctx.hasUI) return null;

	let durationTimer: ReturnType<typeof setInterval> | null = null;

	function renderWidget(): void {
		const records = getIndex().filter(
			(r) => r.status === "running" || r.status === "interrupted",
		);
		if (records.length === 0) {
			ctx.ui.setWidget("bg-sessions", undefined);
			return;
		}

		const cols = 120;
		const lines: string[] = [];
		for (const r of records) {
			const monitorState = coordinator.getMonitorSessionState(r.sessionId);
			const exited = r.status !== "running";
			const dot = exited ? "○" : monitorState ? "◆" : "●";
			const id = r.sessionId;
			const cmd = r.command.replace(/\s+/g, " ").trim();
			const truncCmd = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
			const reason = r.task ? ` · ${r.task}` : "";
			const statusText = monitorState
				? `monitoring${monitorState.eventCount > 0 ? ` e:${monitorState.eventCount}` : ""}`
				: exited
					? r.status
					: "running";
			const duration = formatDuration(Date.now() - Date.parse(r.startedAt));
			const strategy = monitorState ? ` · ${monitorState.strategy}` : "";
			const oneLine = ` ${dot} ${id}  ${truncCmd}${reason}${strategy}  ${statusText} ${duration}`;
			if (visibleWidth(oneLine) <= cols) {
				lines.push(oneLine);
			} else {
				lines.push(truncateToWidth(` ${dot} ${id}  ${cmd}`, cols, "…"));
				lines.push(truncateToWidth(`   ${statusText} ${duration}${reason}`, cols, "…"));
			}
		}
		ctx.ui.setWidget("bg-sessions", lines, { placement: "belowEditor" });
	}

	function manageDurationTimer(): void {
		const hasActive = getIndex().some((r) => r.status === "running" || r.status === "interrupted");
		if (hasActive && !durationTimer) {
			durationTimer = setInterval(renderWidget, 10_000);
		} else if (!hasActive && durationTimer) {
			clearInterval(durationTimer);
			durationTimer = null;
		}
	}

	const unsubscribe = registry.onChange(() => {
		manageDurationTimer();
		renderWidget();
	});

	// Initial render — pick up any records already in the index
	renderWidget();
	manageDurationTimer();

	return () => {
		unsubscribe();
		if (durationTimer) {
			clearInterval(durationTimer);
			durationTimer = null;
		}
		ctx.ui.setWidget("bg-sessions", undefined);
	};
}
