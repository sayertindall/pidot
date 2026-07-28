/**
 * shell/coordinator.ts
 *
 * Overlay handle tracking, monitor session state/history, background-widget
 * cleanup slot, and the agent-handled-completion suppression ledger.
 *
 * The old ledger (agentHandledCompletion: Set<sessionId>) was keyed on the
 * human-readable slug, which gets returned to a reuse pool on release: mark
 * one, never consume it, release the slug, and the next session drawing that
 * slug has its real completion silently swallowed. Fixed by keying on
 * runToken (a uuid, DispatchRequest.launchToken), which is never reused (§6).
 */
import type { OverlayHandle } from "@earendil-works/pi-tui";
import type { HeadlessSupervisor } from "./supervision";
import type { MonitorConfig, MonitorEventPayload, MonitorSessionState, MonitorTerminalReason } from "./types";

const MONITOR_HISTORY_LIMIT = 200;

export type AgentHandledReason = "wait" | "kill" | "background" | "transfer";

/** Centralizes overlay, monitor, widget, and completion-suppression state for the extension runtime. */
export class DispatchCoordinator {
	private overlayOpen = false;
	private overlayHandle: OverlayHandle | null = null;
	private headlessMonitors = new Map<string, HeadlessSupervisor>();
	private monitorEventHistory = new Map<string, MonitorEventPayload[]>();
	private monitorEventCounters = new Map<string, number>();
	private monitorSessionState = new Map<string, MonitorSessionState>();
	private pendingMonitorReason = new Map<string, MonitorTerminalReason>();
	private bgWidgetCleanup: (() => void) | null = null;
	private agentHandled = new Map<string, AgentHandledReason>();

	isOverlayOpen(): boolean {
		return this.overlayOpen;
	}

	beginOverlay(): boolean {
		if (this.overlayOpen) return false;
		this.overlayOpen = true;
		return true;
	}

	endOverlay(): void {
		this.overlayOpen = false;
		this.clearOverlayHandle();
	}

	focusOverlay(): void {
		this.overlayHandle?.focus();
	}

	unfocusOverlay(): void {
		this.overlayHandle?.unfocus();
	}

	isOverlayFocused(): boolean {
		return this.overlayHandle?.isFocused() === true;
	}

	setOverlayHandle(handle: OverlayHandle): void {
		this.overlayHandle = handle;
	}

	clearOverlayHandle(): void {
		this.overlayHandle = null;
	}

	markAgentHandled(runToken: string, reason: AgentHandledReason): void {
		this.agentHandled.set(runToken, reason);
	}

	consumeAgentHandled(runToken: string): { reason: string } | null {
		const reason = this.agentHandled.get(runToken);
		if (reason === undefined) return null;
		this.agentHandled.delete(runToken);
		return { reason };
	}

	setMonitor(id: string, monitor: HeadlessSupervisor): void {
		this.headlessMonitors.set(id, monitor);
	}

	getMonitor(id: string): HeadlessSupervisor | undefined {
		return this.headlessMonitors.get(id);
	}

	deleteMonitor(id: string): void {
		this.headlessMonitors.delete(id);
	}

	registerMonitorSession(sessionId: string, monitor: MonitorConfig, startedAt: Date): MonitorSessionState {
		const state: MonitorSessionState = {
			sessionId,
			strategy: monitor.strategy ?? "stream",
			triggerIds: monitor.triggers.map((trigger) => trigger.id),
			status: "running",
			eventCount: 0,
			startedAt: startedAt.toISOString(),
		};
		this.monitorSessionState.set(sessionId, state);
		return state;
	}

	markMonitorStopping(sessionId: string, reason: MonitorTerminalReason = "stopped"): void {
		this.pendingMonitorReason.set(sessionId, reason);
	}

	consumePendingMonitorReason(sessionId: string): MonitorTerminalReason | undefined {
		const reason = this.pendingMonitorReason.get(sessionId);
		this.pendingMonitorReason.delete(sessionId);
		return reason;
	}

	finalizeMonitorSession(
		sessionId: string,
		result: { exitCode: number | null; signal?: number },
		reason: MonitorTerminalReason,
	): MonitorSessionState | undefined {
		const current = this.monitorSessionState.get(sessionId);
		if (!current) return undefined;
		const finalized: MonitorSessionState = {
			...current,
			status: "stopped",
			endedAt: new Date().toISOString(),
			terminalReason: reason,
			exitCode: result.exitCode,
			signal: result.signal,
		};
		this.monitorSessionState.set(sessionId, finalized);
		this.pendingMonitorReason.delete(sessionId);
		return finalized;
	}

	getMonitorSessionState(sessionId: string): MonitorSessionState | undefined {
		return this.monitorSessionState.get(sessionId);
	}

	recordMonitorEvent(event: Omit<MonitorEventPayload, "eventId" | "timestamp">): MonitorEventPayload {
		const nextId = (this.monitorEventCounters.get(event.sessionId) ?? 0) + 1;
		this.monitorEventCounters.set(event.sessionId, nextId);

		const recorded: MonitorEventPayload = {
			...event,
			eventId: nextId,
			timestamp: new Date().toISOString(),
		};

		const existing = this.monitorEventHistory.get(event.sessionId) ?? [];
		existing.push(recorded);
		if (existing.length > MONITOR_HISTORY_LIMIT) {
			existing.splice(0, existing.length - MONITOR_HISTORY_LIMIT);
		}
		this.monitorEventHistory.set(event.sessionId, existing);

		const currentState = this.monitorSessionState.get(event.sessionId);
		if (currentState) {
			this.monitorSessionState.set(event.sessionId, {
				...currentState,
				eventCount: nextId,
				lastEventId: recorded.eventId,
				lastEventAt: recorded.timestamp,
				lastTriggerId: recorded.triggerId,
			});
		}

		return recorded;
	}

	getMonitorEvents(
		sessionId: string,
		options?: { limit?: number; offset?: number; sinceEventId?: number; triggerId?: string },
	): {
		events: MonitorEventPayload[];
		total: number;
		limit: number;
		offset: number;
		sinceEventId?: number;
		triggerId?: string;
	} {
		let events = this.monitorEventHistory.get(sessionId) ?? [];
		const sinceEventId =
			options?.sinceEventId !== undefined ? Math.max(0, Math.trunc(options.sinceEventId)) : undefined;
		if (sinceEventId !== undefined) {
			events = events.filter((event) => event.eventId > sinceEventId);
		}
		const triggerId = options?.triggerId?.trim();
		if (triggerId) {
			events = events.filter((event) => event.triggerId === triggerId);
		}
		const total = events.length;
		const limit = Math.max(1, Math.trunc(options?.limit ?? 20));
		const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
		const end = Math.max(0, total - offset);
		const start = Math.max(0, end - limit);
		return {
			events: events.slice(start, end),
			total,
			limit,
			offset,
			sinceEventId,
			triggerId,
		};
	}

	clearMonitorEvents(sessionId: string): void {
		this.monitorEventHistory.delete(sessionId);
		this.monitorEventCounters.delete(sessionId);
		this.monitorSessionState.delete(sessionId);
		this.pendingMonitorReason.delete(sessionId);
	}

	disposeMonitor(id: string): void {
		const monitor = this.headlessMonitors.get(id);
		if (!monitor) return;
		monitor.dispose();
		this.headlessMonitors.delete(id);
	}

	disposeAllMonitors(): void {
		for (const monitor of this.headlessMonitors.values()) {
			monitor.dispose();
		}
		this.headlessMonitors.clear();
	}

	replaceBackgroundWidgetCleanup(cleanup: (() => void) | null): void {
		this.bgWidgetCleanup?.();
		this.bgWidgetCleanup = cleanup;
	}

	clearBackgroundWidget(): void {
		this.bgWidgetCleanup?.();
		this.bgWidgetCleanup = null;
	}
}
