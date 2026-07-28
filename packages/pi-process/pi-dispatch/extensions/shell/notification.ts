/**
 * shell/notification.ts
 *
 * Dispatch/monitor notification builders. Status lines here are derived
 * from `legacyFields(termination)` (completion.ts), not from ad-hoc
 * exitCode/cancelled/timedOut booleans set at each call site -- see
 * completion's header comment for why that used to produce wrong text
 * (e.g. a successful quiet-exit reporting as if a human cancelled it). The
 * dispatch notification additionally states `result.status`, the more
 * precise cause-derived signal that legacyFields necessarily discards.
 */

import type { Termination } from "./completion";
import { legacyFields } from "./completion";
import type { DispatchResult, MonitorEventPayload, MonitorSessionState } from "./types";

const BRIEF_TAIL_LINES = 5;

export interface CompletionOutput {
	lines: string[];
	totalLines: number;
	truncated: boolean;
}

export interface HandsFreeUpdate {
	status: "running" | "user-takeover" | "exited" | "killed" | "agent-resumed";
	sessionId: string;
	runtime: number;
	tail: string[];
	tailTruncated: boolean;
	userTookOver?: boolean;
	totalCharsSent?: number;
	budgetExhausted?: boolean;
}

export interface InteractiveOutcome {
	transferred?: CompletionOutput;
	backgrounded?: boolean;
	backgroundId?: string;
	userTookOver?: boolean;
	handoffPreview?: {
		type: "tail";
		when: "exit" | "detach" | "kill" | "timeout" | "transfer";
		lines: string[];
	};
}

export function buildDispatchNotification(
	sessionId: string,
	_result: DispatchResult,
	termination: Termination,
	duration: string,
	completionOutput?: CompletionOutput,
): string {
	const parts = [buildDispatchStatusLine(sessionId, _result, termination, duration)];
	if (completionOutput && completionOutput.totalLines > 0) {
		parts.push(` ${completionOutput.totalLines} lines of output.`);
	}
	appendTailBlock(parts, completionOutput?.lines, BRIEF_TAIL_LINES);
	parts.push(`\n\nAttach to review full output: interactive_shell({ attach: "${sessionId}" })`);
	return parts.join("");
}

export function buildResultNotification(
	sessionId: string,
	_result: DispatchResult,
	termination: Termination,
	completionOutput?: CompletionOutput,
): string {
	const parts = [buildResultStatusLine(sessionId, termination)];
	if (completionOutput && completionOutput.lines.length > 0) {
		const truncNote = completionOutput.truncated ? ` (truncated from ${completionOutput.totalLines} total lines)` : "";
		parts.push(`\nOutput (${completionOutput.lines.length} lines${truncNote}):\n\n${completionOutput.lines.join("\n")}`);
	}
	return parts.join("");
}

export function buildMonitorEventNotification(event: MonitorEventPayload): string {
	return [
		`Monitor Event (${event.sessionId}) #${event.eventId}`,
		`Time: ${event.timestamp}`,
		`Strategy: ${event.strategy}`,
		`Trigger: ${event.triggerId}`,
		`Matched: ${event.matchedText}`,
		`${event.strategy === "poll-diff" ? "Diff" : "Line"}: ${event.lineOrDiff}`,
	].join("\n");
}

export function buildMonitorLifecycleNotification(state: MonitorSessionState): string {
	const reason = state.terminalReason ?? "stopped";
	let headline: string;
	if (reason === "stream-ended") {
		headline = `Monitor ${state.sessionId} stream ended.`;
	} else if (reason === "timed-out") {
		headline = `Monitor ${state.sessionId} timed out.`;
	} else if (reason === "script-failed") {
		headline = `Monitor ${state.sessionId} script failed.`;
	} else {
		headline = `Monitor ${state.sessionId} stopped.`;
	}

	const details: string[] = [
		headline,
		`Strategy: ${state.strategy}`,
		`Events: ${state.eventCount}`,
		state.lastEventAt ? `Last event: #${state.lastEventId} at ${state.lastEventAt}` : "Last event: none",
	];

	if (state.exitCode !== undefined && state.exitCode !== null) {
		details.push(`Exit code: ${state.exitCode}`);
	}
	if (state.signal !== undefined) {
		details.push(`Signal: ${state.signal}`);
	}

	return details.join("\n");
}

export function buildHandsFreeUpdateMessage(update: HandsFreeUpdate): { content: string; details: HandsFreeUpdate } | null {
	if (update.status === "running") return null;

	const tail = update.tail.length > 0 ? `\n\n${update.tail.join("\n")}` : "";
	let statusLine: string;
	switch (update.status) {
		case "exited":
			statusLine = `Session ${update.sessionId} exited (${formatDurationMs(update.runtime)})`;
			break;
		case "killed":
			statusLine = `Session ${update.sessionId} killed (${formatDurationMs(update.runtime)})`;
			break;
		case "user-takeover":
			statusLine = `Session ${update.sessionId}: user took over (${formatDurationMs(update.runtime)})`;
			break;
		case "agent-resumed":
			statusLine = `Session ${update.sessionId}: agent resumed monitoring (${formatDurationMs(update.runtime)})`;
			break;
		default:
			statusLine = `Session ${update.sessionId} update (${formatDurationMs(update.runtime)})`;
	}
	return { content: statusLine + tail, details: update };
}

export function summarizeInteractiveResult(
	command: string,
	termination: Termination,
	outcome: InteractiveOutcome,
	timeout?: number,
	reason?: string,
): string {
	let summary = buildInteractiveSummary(termination, outcome, timeout);

	if (outcome.userTookOver) {
		summary += "\n\nNote: User took over control during hands-free mode.";
	}

	if (!outcome.transferred && outcome.handoffPreview?.type === "tail" && outcome.handoffPreview.lines.length > 0) {
		summary += `\n\nOverlay tail (${outcome.handoffPreview.when}, last ${outcome.handoffPreview.lines.length} lines):\n${outcome.handoffPreview.lines.join("\n")}`;
	}

	const warning = buildIdlePromptWarning(command, reason);
	if (warning) {
		summary += `\n\n${warning}`;
	}

	return summary;
}

export function buildIdlePromptWarning(command: string, reason: string | undefined): string | null {
	if (!reason) return null;

	const tasky = /\b(scan|check|review|summariz|analyz|inspect|audit|find|fix|refactor|debug|investigat|explore|enumerat|list)\b/i;
	if (!tasky.test(reason)) return null;

	const trimmed = command.trim();
	const binaries = ["pi", "claude", "codex", "gemini", "agent"] as const;
	const bin = binaries.find((candidate) => trimmed === candidate || trimmed.startsWith(`${candidate} `));
	if (!bin) return null;

	const rest = trimmed === bin ? "" : trimmed.slice(bin.length).trim();
	const hasQuotedPrompt = /["']/.test(rest);
	const hasKnownPromptFlag =
		/\b(-p|--print|--prompt|--prompt-interactive|-i|exec)\b/.test(rest) ||
		(bin === "pi" && /\b-p\b/.test(rest)) ||
		(bin === "codex" && /\bexec\b/.test(rest));

	if (hasQuotedPrompt || hasKnownPromptFlag) return null;
	if (!looksLikeIdleCommand(rest)) return null;

	const examplePrompt = reason.replace(/\s+/g, " ").trim();
	const clipped = examplePrompt.length > 120 ? `${examplePrompt.slice(0, 117)}...` : examplePrompt;
	return `Note: \`reason\` is UI-only. This command likely started the agent idle. If you intended an initial prompt, embed it in \`command\`, e.g. \`${bin} "${clipped}"\`.`;
}

function buildDispatchStatusLine(sessionId: string, result: DispatchResult, termination: Termination, duration: string): string {
	const { cancelled, timedOut, exitCode } = legacyFields(termination);
	if (timedOut) return `Session ${sessionId} timed out (${duration}). Status: ${result.status}.`;
	if (cancelled) return `Session ${sessionId} was killed (${duration}). Status: ${result.status}.`;
	if (exitCode === 0) return `Session ${sessionId} completed successfully (${duration}). Status: ${result.status}.`;
	return `Session ${sessionId} exited with code ${exitCode} (${duration}). Status: ${result.status}.`;
}

function buildResultStatusLine(sessionId: string, termination: Termination): string {
	const { cancelled, timedOut, exitCode } = legacyFields(termination);
	if (timedOut) return `Session ${sessionId} timed out.`;
	if (cancelled) return `Session ${sessionId} was killed.`;
	if (exitCode === 0) return `Session ${sessionId} completed successfully.`;
	return `Session ${sessionId} exited with code ${exitCode}.`;
}

function buildInteractiveSummary(termination: Termination, outcome: InteractiveOutcome, timeout?: number): string {
	if (outcome.transferred) {
		const truncatedNote = outcome.transferred.truncated ? ` (truncated from ${outcome.transferred.totalLines} total lines)` : "";
		return `Session output transferred (${outcome.transferred.lines.length} lines${truncatedNote}):\n\n${outcome.transferred.lines.join("\n")}`;
	}
	if (outcome.backgrounded) {
		return `Session running in background (id: ${outcome.backgroundId}). User can reattach with /attach ${outcome.backgroundId}`;
	}
	const { cancelled, timedOut, exitCode } = legacyFields(termination);
	if (cancelled) return "User killed the interactive session";
	if (timedOut) return `Session killed after timeout (${timeout ?? "?"}ms)`;
	const status = exitCode === 0 ? "successfully" : `with code ${exitCode}`;
	return `Session ended ${status}`;
}

function appendTailBlock(parts: string[], lines: string[] | undefined, tailLines: number): void {
	if (!lines || lines.length === 0) return;
	let end = lines.length;
	while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
	const tail = lines.slice(Math.max(0, end - tailLines), end);
	if (tail.length > 0) {
		parts.push(`\n\n${tail.join("\n")}`);
	}
}

function looksLikeIdleCommand(rest: string): boolean {
	return rest.length === 0 || /^(-{1,2}[A-Za-z0-9][A-Za-z0-9-]*(?:=[^\s]+|\s+[^\s-][^\s]*)?\s*)+$/.test(rest);
}

// types.ts only exports second-precision formatDuration; hands-free updates
// can complete in under a second, so keep the ms-precision variant local to
// this file rather than losing that resolution.
function formatDurationMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}
