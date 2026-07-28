/**
 * shell/supervision.ts
 *
 * Quiet/interval/timeout/grace timer engine, ported from
 * pi-shell-old/headless-monitor's HeadlessDispatchMonitor. Trigger
 * compilation and chunk-buffered matching live in triggers.ts; this file
 * only owns timers, PTY subscription, sentinel scanning, and completion.
 *
 * The fix (completion's header has the full story): the old class's
 * handleCompletion/handleExternalCompletion built ad-hoc
 * { exitCode, signal, timedOut, cancelled } objects with three different
 * meanings crammed into the "cancelled" bit. Every terminal path here
 * records which TerminationCause actually happened and hands it to
 * completion's resolve() instead, so a successful quiet-triggered
 * dispatch completion no longer reports as a human cancellation.
 */
import { stripVTControlCharacters } from "node:util";
import type { DispatchConfig } from "./config";
import { resolve, type CompletionContract, type Resolution, type Termination, type TerminationCause } from "./completion";
import type { PtyRuntime } from "./runtime";
import { findSentinel } from "./sentinel";
import {
	bufferLines,
	canEmitTrigger,
	compileTrigger,
	normalizeMonitorSnapshot,
	shouldEmitUnique,
	summarizeDiff,
	type MonitorTriggerMatcher,
} from "./triggers";
import type { MonitorConfig, MonitorStrategy } from "./types";

export interface MonitorMatchInfo {
	strategy: MonitorStrategy;
	triggerId: string;
	eventType: string;
	matchedText: string;
	lineOrDiff: string;
	stream: "pty";
}

export interface HeadlessSupervisorSentinelExpectation {
	recordId: string;
	launchToken: string;
}

/** Runtime options for supervising a headless dispatch session. */
export interface HeadlessSupervisorOptions {
	autoExitOnQuiet: boolean;
	quietThreshold: number;
	gracePeriod?: number;
	timeout?: number;
	monitor?: MonitorConfig;
	onMonitorEvent?: (event: MonitorMatchInfo) => void | Promise<void>;
	/** Original session start time in ms since epoch, preserved when a foreground session moves headless. */
	startedAt?: number;
	/** Presence selects contract: "sentinel"; scanned for on every data event. */
	sentinel?: HeadlessSupervisorSentinelExpectation;
}

export interface SupervisionResult {
	termination: Termination;
	resolution: Resolution;
	completionOutput: { lines: string[]; totalLines: number; truncated: boolean };
}

/** Injectable clock so timer behavior is testable without real delays. */
export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

type ChildExitCause = Extract<TerminationCause, "child_exit" | "timeout" | "quiet_auto_exit">;
type ExternalCause = Extract<TerminationCause, "user_kill" | "agent_kill" | "shutdown">;

export class HeadlessSupervisor {
	readonly startTime: number;

	private readonly contract: CompletionContract;
	private readonly triggers: MonitorTriggerMatcher[];

	private _disposed = false;
	private quietTimer: unknown = null;
	private timeoutTimer: unknown = null;
	private pollTimer: unknown = null;
	private pollInFlight = false;
	private pollInitialized = false;
	private lastPollSnapshot = "";
	private pollReadOffset = 0;

	private result: SupervisionResult | undefined;
	private completeCallbacks: Array<() => void> = [];

	private unsubData: (() => void) | null = null;
	private unsubExit: (() => void) | null = null;

	private monitorLineBuffer = "";
	private emittedMonitorKeys = new Set<string>();
	private triggerLastEmitAt = new Map<string, number>();

	private sentinelSeen = false;
	private sentinelExitCode: number | null = null;

	get disposed(): boolean {
		return this._disposed;
	}

	constructor(
		private readonly runtime: PtyRuntime,
		private readonly config: DispatchConfig,
		private readonly options: HeadlessSupervisorOptions,
		private readonly onComplete: (result: SupervisionResult) => void,
		private readonly clock: Clock = systemClock,
	) {
		this.startTime = options.startedAt ?? clock.now();
		this.contract = options.sentinel ? "sentinel" : "exit-code";
		this.triggers = (options.monitor?.triggers ?? []).map(compileTrigger);

		this.subscribe();

		if (options.autoExitOnQuiet) {
			this.resetQuietTimer();
		}

		if (options.timeout && options.timeout > 0) {
			this.timeoutTimer = clock.setTimeout(() => {
				this.timeoutTimer = null;
				this.handleTerminal("timeout", null, undefined);
			}, options.timeout);
		}

		if (options.monitor?.strategy === "poll-diff") {
			this.startPollTimer();
		}

		if (runtime.exited) {
			queueMicrotask(() => {
				if (!this._disposed) {
					this.scanForSentinel();
					this.handleTerminal("child_exit", runtime.exitCode, runtime.signal);
				}
			});
		}
	}

	private subscribe(): void {
		this.unsubscribe();
		this.unsubData = this.runtime.addDataListener((data) => {
			const visible = stripVTControlCharacters(data);
			if (this.options.autoExitOnQuiet && visible.trim().length > 0) {
				this.resetQuietTimer();
			}
			if (this.contract === "sentinel") {
				this.scanForSentinel();
			}
			if (this.options.monitor?.strategy !== "poll-diff" && this.options.onMonitorEvent) {
				this.processMonitorData(visible, false);
			}
		});
		this.unsubExit = this.runtime.addExitListener((exitCode, signal) => {
			if (!this._disposed) {
				this.handleTerminal("child_exit", exitCode, signal);
			}
		});
	}

	private unsubscribe(): void {
		this.unsubData?.();
		this.unsubData = null;
		this.unsubExit?.();
		this.unsubExit = null;
	}

	private scanForSentinel(): void {
		const expectation = this.options.sentinel;
		if (!expectation || this.sentinelSeen) return;
		const output = this.runtime.getRawStream({ sinceLast: false, stripAnsi: true });
		const rc = findSentinel(output, expectation.recordId, expectation.launchToken);
		if (rc !== undefined) {
			this.sentinelSeen = true;
			this.sentinelExitCode = rc;
		}
	}

	// --- stream trigger matching ---

	private processMonitorData(chunk: string, flushTrailing: boolean): void {
		const { lines, remainder } = bufferLines(this.monitorLineBuffer, chunk, flushTrailing);
		this.monitorLineBuffer = remainder;
		for (const line of lines) {
			this.emitStreamMatches(line);
		}
	}

	private emitStreamMatches(line: string): void {
		const monitor = this.options.monitor;
		if (!monitor || monitor.strategy === "poll-diff") return;
		for (const trigger of this.triggers) {
			const matchedText = trigger.match(line);
			if (!matchedText) continue;
			if (!this.canEmit(trigger.id, trigger.cooldownMs)) continue;
			if (!this.shouldEmit(trigger.id, line)) continue;
			this.emitMonitorEvent({
				strategy: monitor.strategy ?? "stream",
				triggerId: trigger.id,
				eventType: trigger.id,
				matchedText,
				lineOrDiff: line,
				stream: "pty",
			});
		}
	}

	// --- poll-diff interval timer ---

	private startPollTimer(): void {
		const monitor = this.options.monitor;
		if (!monitor || monitor.strategy !== "poll-diff") return;
		const intervalMs = Math.max(250, Math.trunc(monitor.poll?.intervalMs || 5000));
		this.pollTimer = this.clock.setInterval(() => {
			void this.processPollTick();
		}, intervalMs);
	}

	private stopPollTimer(): void {
		if (this.pollTimer === null) return;
		this.clock.clearInterval(this.pollTimer);
		this.pollTimer = null;
	}

	private async processPollTick(): Promise<void> {
		if (this._disposed || this.pollInFlight) return;
		const monitor = this.options.monitor;
		if (!monitor || monitor.strategy !== "poll-diff") return;
		this.pollInFlight = true;
		try {
			const raw = this.runtime.getRawStream({ sinceLast: false, stripAnsi: true });
			if (this.pollReadOffset > raw.length) {
				this.pollReadOffset = raw.length;
			}
			const sample = normalizeMonitorSnapshot(raw.slice(this.pollReadOffset));
			this.pollReadOffset = raw.length;
			if (!this.pollInitialized) {
				this.lastPollSnapshot = sample;
				this.pollInitialized = true;
				return;
			}
			if (sample === this.lastPollSnapshot) return;
			const previous = this.lastPollSnapshot;
			this.lastPollSnapshot = sample;
			const diffSummary = summarizeDiff(previous, sample);

			for (const trigger of this.triggers) {
				const matchedText = trigger.match(sample);
				if (!matchedText) continue;
				if (!this.canEmit(trigger.id, trigger.cooldownMs)) continue;
				if (!this.shouldEmit(trigger.id, diffSummary)) continue;
				this.emitMonitorEvent({
					strategy: "poll-diff",
					triggerId: trigger.id,
					eventType: trigger.id,
					matchedText,
					lineOrDiff: diffSummary,
					stream: "pty",
				});
			}
		} catch (error) {
			console.error("pi-dispatch: poll-diff tick error:", error);
		} finally {
			this.pollInFlight = false;
		}
	}

	private canEmit(triggerId: string, triggerCooldownMs: number | undefined): boolean {
		const cooldown = triggerCooldownMs ?? this.options.monitor?.throttle?.cooldownMs;
		return canEmitTrigger(this.triggerLastEmitAt, triggerId, cooldown, this.clock.now());
	}

	private shouldEmit(triggerId: string, text: string): boolean {
		if (this.options.monitor?.throttle?.dedupeExactLine === false) return true;
		return shouldEmitUnique(this.emittedMonitorKeys, triggerId, text);
	}

	private emitMonitorEvent(event: MonitorMatchInfo): void {
		try {
			const maybePromise = this.options.onMonitorEvent?.(event);
			if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
				void (maybePromise as Promise<unknown>).catch((error) => {
					console.error("pi-dispatch: monitor event callback error:", error);
				});
			}
		} catch (error) {
			console.error("pi-dispatch: monitor event callback error:", error);
		}
	}

	// --- quiet / grace timer ---

	private resetQuietTimer(): void {
		this.stopQuietTimer();
		this.quietTimer = this.clock.setTimeout(() => {
			this.quietTimer = null;
			if (this._disposed || !this.options.autoExitOnQuiet) return;
			const gracePeriod = this.options.gracePeriod ?? this.config.autoExitGracePeriod;
			if (this.clock.now() - this.startTime < gracePeriod) {
				this.resetQuietTimer();
				return;
			}
			this.handleTerminal("quiet_auto_exit", null, undefined);
		}, this.options.quietThreshold);
	}

	private stopQuietTimer(): void {
		if (this.quietTimer === null) return;
		this.clock.clearTimeout(this.quietTimer);
		this.quietTimer = null;
	}

	private clearTimeoutTimer(): void {
		if (this.timeoutTimer === null) return;
		this.clock.clearTimeout(this.timeoutTimer);
		this.timeoutTimer = null;
	}

	// --- completion output capture, unchanged from the old captureOutput ---

	private captureOutput(): SupervisionResult["completionOutput"] {
		try {
			const result = this.runtime.getTailLines({
				lines: this.config.completionNotifyLines,
				ansi: false,
				maxChars: this.config.completionNotifyMaxChars,
			});
			return {
				lines: result.lines,
				totalLines: result.totalLinesInBuffer,
				truncated: result.lines.length < result.totalLinesInBuffer || result.truncatedByChars,
			};
		} catch {
			// PTY terminal may already be disposed during completion -- safe to return empty
			return { lines: [], totalLines: 0, truncated: false };
		}
	}

	// --- terminal paths ---

	private teardown(flushMonitor: boolean): void {
		if (flushMonitor && this.options.monitor?.strategy !== "poll-diff" && this.options.onMonitorEvent) {
			this.processMonitorData("", true);
		}
		this._disposed = true;
		this.stopQuietTimer();
		this.stopPollTimer();
		this.clearTimeoutTimer();
		this.unsubscribe();
	}

	private finish(
		cause: TerminationCause,
		exitCode: number | null,
		signal: number | undefined,
		completionOutputOverride?: SupervisionResult["completionOutput"],
	): void {
		const termination: Termination = {
			cause,
			contract: this.contract,
			exitCode,
			signal: signal ?? null,
			sentinelSeen: this.sentinelSeen,
			sentinelExitCode: this.sentinelExitCode,
		};
		const result: SupervisionResult = {
			termination,
			resolution: resolve(termination),
			completionOutput: completionOutputOverride ?? this.captureOutput(),
		};
		this.result = result;
		this.triggerCompleteCallbacks();
		this.onComplete(result);
	}

	private handleTerminal(cause: ChildExitCause, exitCode: number | null, signal: number | undefined): void {
		if (this._disposed) return;
		this.teardown(true);
		if (cause === "timeout" || cause === "quiet_auto_exit") {
			this.runtime.kill();
		}
		this.finish(cause, exitCode, signal);
	}

	/** Force a terminal resolution for a cause this class did not itself observe: UI kill, session_shutdown. */
	handleExternalCompletion(
		cause: ExternalCause,
		exitCode: number | null,
		signal?: number,
		completionOutput?: SupervisionResult["completionOutput"],
	): void {
		if (this._disposed) return;
		this.teardown(true);
		this.finish(cause, exitCode, signal, completionOutput);
	}

	getResult(): SupervisionResult | undefined {
		return this.result;
	}

	registerCompleteCallback(callback: () => void): void {
		if (this.result) {
			callback();
			return;
		}
		this.completeCallbacks.push(callback);
	}

	private triggerCompleteCallbacks(): void {
		for (const cb of this.completeCallbacks) {
			try {
				cb();
			} catch (error) {
				console.error("pi-dispatch: headless completion callback error:", error);
			}
		}
		this.completeCallbacks = [];
	}

	dispose(): void {
		if (this._disposed) return;
		this.teardown(false);
	}
}
