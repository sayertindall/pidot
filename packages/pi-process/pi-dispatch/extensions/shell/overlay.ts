/**
 * shell/overlay.ts
 *
 * TUI overlay controller (interactive mode). Ported from
 * pi-shell-old/overlay-component.ts and reattach-overlay.ts, but this
 * controller only computes a frame.ts ViewModel and hands it to
 * renderOverlayFrame -- no line-building here. It also drops the old
 * hands-free/user-takeover tracking those two files had: a LiveSession
 * carries no takeover state, so the detach dialog never offers
 * "return-to-agent" (DialogChoice stays a superset for other callers that
 * do track takeover, e.g. a future hands-free supervisor).
 */
import type { Component, Focusable, KeyId, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DispatchConfig } from "./config";
import type { DispatchCoordinator } from "./coordinator";
import { computeTerminalRows, DIALOG_OPTIONS, renderOverlayFrame, type ViewModel } from "./frame";
import { translateInput } from "./key-encoding";
import type { LiveSession } from "./session";
import type { DialogChoice } from "./types";

type DialogSelection = (typeof DIALOG_OPTIONS)[number]["key"];

const RENDER_DEBOUNCE_MS = 16;
const COUNTDOWN_INTERVAL_MS = 1000;

class ShellOverlayComponent implements Component, Focusable {
	focused = false;

	private state: "running" | "exited" | "detach-dialog" = "running";
	private dialogSelection: DialogSelection = "transfer";
	private exitCountdown = 0;
	private countdownTimer: ReturnType<typeof setInterval> | null = null;
	private renderTimer: ReturnType<typeof setTimeout> | null = null;
	private lastInnerWidth = 0;
	private lastTermRows = 0;
	private finished = false;
	private readonly unsubscribeData: () => void;
	private readonly unsubscribeExit: () => void;

	constructor(
		private readonly tui: TUI,
		private readonly session: LiveSession,
		private readonly coordinator: DispatchCoordinator,
		private readonly config: DispatchConfig,
		private readonly done: (result: DialogChoice | "exited") => void,
	) {
		this.unsubscribeData = session.runtime.addDataListener(() => this.debouncedRender());
		this.unsubscribeExit = session.runtime.addExitListener(() => this.handleExit());
		if (session.runtime.exited) {
			queueMicrotask(() => {
				if (!this.finished) this.handleExit();
			});
		}
	}

	private debouncedRender(): void {
		if (this.renderTimer) clearTimeout(this.renderTimer);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = null;
			this.tui.requestRender();
		}, RENDER_DEBOUNCE_MS);
	}

	private handleExit(): void {
		if (this.finished || this.state === "exited") return;
		this.state = "exited";
		this.exitCountdown = this.config.exitAutoCloseDelay;
		this.startCountdown();
		this.tui.requestRender();
	}

	private startCountdown(): void {
		this.stopCountdown();
		this.countdownTimer = setInterval(() => {
			this.exitCountdown -= 1;
			if (this.exitCountdown <= 0) {
				this.finish("exited");
			} else {
				this.tui.requestRender();
			}
		}, COUNTDOWN_INTERVAL_MS);
	}

	private stopCountdown(): void {
		if (this.countdownTimer) {
			clearInterval(this.countdownTimer);
			this.countdownTimer = null;
		}
	}

	private finish(result: DialogChoice | "exited"): void {
		if (this.finished) return;
		this.finished = true;
		this.stopCountdown();
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
		this.done(result);
	}

	render(width: number): string[] {
		const overlayHeightRows = Math.floor((this.tui.terminal.rows * this.config.overlayHeightPercent) / 100);
		const termRows = computeTerminalRows(overlayHeightRows, this.state);
		const innerWidth = Math.max(4, width) - 4;

		if (termRows > 0 && (innerWidth !== this.lastInnerWidth || termRows !== this.lastTermRows)) {
			this.session.runtime.resize(innerWidth, termRows);
			this.lastInnerWidth = innerWidth;
			this.lastTermRows = termRows;
			// Resize can shift the viewport to the top of scrollback; pin back
			// to the bottom so the overlay doesn't flash stale content.
			this.session.runtime.scrollToBottom();
		}

		const viewportLines =
			termRows > 0 ? this.session.runtime.getViewportLines({ ansi: this.config.ansiReemit }) : [];

		const vm: ViewModel = {
			sessionId: this.session.sessionId,
			command: this.session.command,
			reason: this.session.reason,
			pid: this.session.runtime.pid,
			focused: this.focused,
			state: this.state,
			elapsedMs: Date.now() - this.session.startedAt.getTime(),
			width,
			viewportLines,
			isScrolledUp: this.session.runtime.isScrolledUp(),
			exitCode: this.session.runtime.exitCode,
			exitCountdownSeconds: this.state === "exited" ? this.exitCountdown : undefined,
			focusShortcut: this.config.focusShortcut,
			dialogSelection: this.state === "detach-dialog" ? this.dialogSelection : undefined,
		};

		return renderOverlayFrame(vm);
	}

	handleInput(data: string): void {
		if (this.state === "detach-dialog") {
			this.handleDialogInput(data);
			return;
		}

		// focusShortcut is user-configurable at runtime, so it can't be a KeyId
		// literal statically -- matchesKey validates the actual match at runtime.
		if (matchesKey(data, this.config.focusShortcut as KeyId)) {
			this.coordinator.unfocusOverlay();
			return;
		}

		// Ctrl+T: quick transfer, works even after exit.
		if (matchesKey(data, "ctrl+t")) {
			this.session.runtime.kill();
			this.finish("transfer");
			return;
		}

		// Ctrl+B: quick background, dismiss overlay and keep the process running.
		if (matchesKey(data, "ctrl+b") && !this.session.runtime.exited) {
			this.finish("background");
			return;
		}

		if (this.state === "exited") {
			if (data.length > 0) this.finish("exited");
			return;
		}

		if (matchesKey(data, "ctrl+q")) {
			this.state = "detach-dialog";
			this.dialogSelection = "transfer";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "shift+up")) {
			this.session.runtime.scrollUp(Math.max(1, this.session.runtime.rows - 2));
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "shift+down")) {
			this.session.runtime.scrollDown(Math.max(1, this.session.runtime.rows - 2));
			this.tui.requestRender();
			return;
		}

		this.session.runtime.write(translateInput(data));
	}

	private handleDialogInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.state = "running";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			const keys = DIALOG_OPTIONS.map((opt) => opt.key);
			const currentIdx = keys.indexOf(this.dialogSelection);
			const direction = matchesKey(data, "up") ? -1 : 1;
			const nextIdx = (currentIdx + direction + keys.length) % keys.length;
			this.dialogSelection = keys[nextIdx] as DialogSelection;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "enter")) {
			switch (this.dialogSelection) {
				case "transfer":
					this.session.runtime.kill();
					this.finish("transfer");
					break;
				case "kill":
					this.session.runtime.kill();
					this.finish("kill");
					break;
				case "background":
					this.finish("background");
					break;
				case "cancel":
					this.state = "running";
					this.tui.requestRender();
					break;
			}
		}
	}

	invalidate(): void {
		this.lastInnerWidth = 0;
		this.lastTermRows = 0;
	}

	dispose(): void {
		this.stopCountdown();
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
		this.unsubscribeData();
		this.unsubscribeExit();
		// UI teardown only. The PTY keeps running unless a dialog action above
		// already killed it -- process/session lifecycle belongs to whoever
		// owns the LiveSession, not this view.
	}
}

/**
 * Show the interactive overlay for `session` and resolve once the user (or
 * the process exiting on its own) ends it. Owns the DispatchCoordinator's
 * single-overlay slot for the duration of the call: begins it before
 * showing, releases it in `finally` regardless of outcome.
 */
export function openOverlay(
	_pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: LiveSession,
	coordinator: DispatchCoordinator,
	config: DispatchConfig,
): Promise<DialogChoice | "exited"> {
	if (!coordinator.beginOverlay()) {
		return Promise.reject(new Error("An overlay is already open."));
	}

	const result = ctx.ui.custom<DialogChoice | "exited">(
		(tui, _theme, _keybindings, done) => new ShellOverlayComponent(tui, session, coordinator, config, done),
		{
			overlay: true,
			overlayOptions: {
				width: `${config.overlayWidthPercent}%`,
				maxHeight: `${config.overlayHeightPercent}%`,
				anchor: "center",
				margin: 1,
				nonCapturing: true,
			},
			onHandle: (handle: OverlayHandle) => {
				coordinator.setOverlayHandle(handle);
				handle.focus();
			},
		},
	);

	return result.finally(() => {
		coordinator.endOverlay();
	});
}
