/**
 * ui.ts
 *
 * "pi-subagents" status widget -- a one-line summary of running/queued
 * agents, shown above the editor. This is a deliberately trimmed first pass
 * (SUB-SPEC-v4.md §8): the reference's `agent-widget.ts` (566 lines) renders
 * a full per-agent tree with spinners, live activity, and token stats, and
 * ships alongside `fleet-list.ts`, `schedule-menu.ts`, and
 * `conversation-viewer.ts`. None of that lands here -- just the widget
 * registration/summary-line/mode-filter skeleton, modeled on
 * pi-dispatch/extensions/shell/widget.ts's already-working
 * `ctx.ui.setWidget()` pattern (same widget-key convention, same
 * session_start/session_shutdown cleanup-function-return convention, same
 * requestRender()-based update path instead of tearing down and
 * re-registering the widget component on every change).
 *
 * WidgetMode (types.ts) filtering: "off" never shows the widget.
 * "background" excludes only agents with isBackground === false -- an
 * explicit foreground agent, which already renders inline as its own Agent
 * tool-call result and would otherwise be double-rendered. Agents with
 * isBackground === undefined (a spawn path that never declared it) stay
 * visible; only the proven-foreground `false` case drops out. "all" shows
 * every agent regardless of isBackground.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentRecord, WidgetMode } from "./types.ts";

const WIDGET_KEY = "pi-subagents";

/** Module-scoped widget state. One pi extension process hosts one active
 * session's widget at a time, same assumption pi-dispatch's widget.ts makes. */
let currentMode: WidgetMode = "background";
let uiRef: ExtensionContext["ui"] | null = null;
let sourceRef: { listAgents(): readonly AgentRecord[] } | null = null;
let tuiRef: { requestRender: () => void } | null = null;
let registered = false;

export interface AgentWidgetOptions {
	/** Initial WidgetMode. Defaults to "background" (foreground agents already render inline). */
	mode?: WidgetMode;
}

function visibleAgents(): readonly AgentRecord[] {
	if (currentMode === "off" || !sourceRef) return [];
	const all = sourceRef.listAgents();
	if (currentMode === "background") return all.filter((a) => a.isBackground !== false);
	return all;
}

function summaryLine(width: number): string[] {
	const agents = visibleAgents();
	let running = 0;
	let queued = 0;
	for (const a of agents) {
		if (a.status === "running") running++;
		else if (a.status === "queued") queued++;
	}
	const total = running + queued;
	if (total === 0) return [];

	let text: string;
	if (running > 0 && queued > 0) {
		text = `${running} running, ${queued} queued · /agents`;
	} else if (running > 0) {
		text = `${running} agent${running === 1 ? "" : "s"} running · /agents`;
	} else {
		text = `${queued} agent${queued === 1 ? "" : "s"} queued · /agents`;
	}
	return [truncateToWidth(text, width || 120)];
}

/** Register or clear the widget based on current visibility, and re-render
 * an already-registered widget in place (no teardown/re-register). */
function sync(): void {
	if (!uiRef) return;
	const hasAny = visibleAgents().some((a) => a.status === "running" || a.status === "queued");

	if (!hasAny) {
		if (registered) {
			uiRef.setWidget(WIDGET_KEY, undefined);
			registered = false;
			tuiRef = null;
		}
		return;
	}

	if (!registered) {
		uiRef.setWidget(
			WIDGET_KEY,
			(tui) => {
				tuiRef = tui;
				return {
					render: (width: number) => summaryLine(width),
					invalidate: () => {},
				};
			},
			{ placement: "aboveEditor" },
		);
		registered = true;
	} else {
		tuiRef?.requestRender();
	}
}

/**
 * Register the "pi-subagents" widget against the given agent source.
 * Duck-typed to `{ listAgents(): readonly AgentRecord[] }` rather than
 * importing runtime.ts's AgentManager directly, since runtime.ts depends on
 * this module (not the other way around) and importing it here would be
 * circular/premature.
 *
 * Call from `session_start`; call the returned cleanup function from
 * `session_shutdown`, same convention as
 * pi-dispatch/extensions/shell/widget.ts's setupBackgroundWidget. Returns
 * null when there's no UI to attach to.
 */
export function setupAgentWidget(
	ctx: ExtensionContext,
	manager: { listAgents(): readonly AgentRecord[] },
	opts?: AgentWidgetOptions,
): (() => void) | null {
	if (!ctx.hasUI) return null;

	uiRef = ctx.ui;
	sourceRef = manager;
	currentMode = opts?.mode ?? currentMode;

	sync();

	return () => {
		if (registered) {
			uiRef?.setWidget(WIDGET_KEY, undefined);
		}
		registered = false;
		tuiRef = null;
		uiRef = null;
		sourceRef = null;
	};
}

/** Change the widget's WidgetMode at runtime and trigger a re-render/re-filter. */
export function setWidgetMode(mode: WidgetMode): void {
	currentMode = mode;
	sync();
}

/** Current WidgetMode, mainly for tests and /agents-widget status display. */
export function getWidgetMode(): WidgetMode {
	return currentMode;
}
