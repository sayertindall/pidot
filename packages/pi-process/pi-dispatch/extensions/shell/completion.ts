/**
 * shell/completion.ts
 *
 * The completion model: cause first, status derived.
 *
 * Old code's four booleans (exitCode, signal, cancelled, timedOut) were set
 * at seven different call sites with overlapping meaning: `cancelled` meant
 * "a human clicked kill" and "quiet-detection auto-killed it" and
 * "session_shutdown killed everything" — same bit, three different facts.
 * Record which one happened here. Derive the rest.
 *
 * Old bug this fixes: `quiet_auto_exit` used to map to `stopped` ("user said
 * no"), which is what happens by default on every mode:"dispatch" call since
 * autoExitOnQuiet defaults on for dispatch. Under the old mapping, a
 * successful delegation reported as if a human cancelled it. Fixed by giving
 * `quiet_auto_exit` its own row instead of folding it into `cancelled`.
 */

import type { TerminalStatus } from "./types";

export type TerminationCause =
	| "child_exit"
	| "sentinel"
	| "timeout"
	| "quiet_auto_exit"
	| "user_kill"
	| "agent_kill"
	| "monitor_stop"
	| "transfer"
	| "shutdown";

export type CompletionContract = "sentinel" | "exit-code";

export type CompletionEvidence = "sentinel" | "exit_code" | "quiet" | "timeout" | "signal" | "explicit";
export type CompletionConfidence = "verified" | "heuristic";

export interface Termination {
	cause: TerminationCause;
	contract: CompletionContract;
	exitCode: number | null;
	signal: number | null;
	sentinelSeen: boolean;
	sentinelExitCode: number | null;
}

export interface Resolution {
	status: TerminalStatus;
	evidence: CompletionEvidence;
	confidence: CompletionConfidence;
	reason?: string;
}

const EXPLICIT_STOP_CAUSES = new Set<TerminationCause>(["user_kill", "agent_kill", "shutdown"]);
const EXPLICIT_COMPLETE_CAUSES = new Set<TerminationCause>(["monitor_stop", "transfer"]);

function resolveExitCodeContract(t: Termination): Resolution {
	switch (t.cause) {
		case "child_exit": {
			if (t.signal !== null && t.exitCode === null) {
				return { status: "failed", evidence: "signal", confidence: "verified" };
			}
			return t.exitCode === 0
				? { status: "completed", evidence: "exit_code", confidence: "verified" }
				: { status: "failed", evidence: "exit_code", confidence: "verified" };
		}
		case "quiet_auto_exit":
			return { status: "completed", evidence: "quiet", confidence: "heuristic" };
		case "timeout":
			return { status: "failed", evidence: "timeout", confidence: "verified" };
		default:
			if (EXPLICIT_STOP_CAUSES.has(t.cause)) {
				return { status: "stopped", evidence: "explicit", confidence: "verified" };
			}
			if (EXPLICIT_COMPLETE_CAUSES.has(t.cause)) {
				return { status: "completed", evidence: "explicit", confidence: "verified" };
			}
			return { status: "failed", evidence: "explicit", confidence: "verified", reason: `unhandled cause: ${t.cause}` };
	}
}

function resolveSentinelContract(t: Termination): Resolution {
	if (t.sentinelSeen) {
		const rc = t.sentinelExitCode ?? 0;
		return rc === 0
			? { status: "completed", evidence: "sentinel", confidence: "verified" }
			: { status: "failed", evidence: "sentinel", confidence: "verified" };
	}

	if (t.cause === "timeout") {
		return { status: "failed", evidence: "timeout", confidence: "verified" };
	}
	if (t.cause === "quiet_auto_exit") {
		return { status: "failed", evidence: "quiet", confidence: "heuristic" };
	}
	if (t.cause === "child_exit") {
		return t.exitCode === 0
			? {
					status: "failed",
					evidence: "exit_code",
					confidence: "verified",
					reason: "exited cleanly without the completion marker",
				}
			: { status: "failed", evidence: "exit_code", confidence: "verified" };
	}
	if (EXPLICIT_STOP_CAUSES.has(t.cause)) {
		return { status: "stopped", evidence: "explicit", confidence: "verified" };
	}
	return { status: "failed", evidence: "explicit", confidence: "verified", reason: `unhandled cause: ${t.cause}` };
}

export function resolve(t: Termination): Resolution {
	return t.contract === "sentinel" ? resolveSentinelContract(t) : resolveExitCodeContract(t);
}

// `interrupted` is real, not reserved-and-unused: it's what state's
// startup reconcile pass assigns to a "running" record whose PID is dead and
// nobody recorded why. resolve() never produces it — only the reconcile scan
// does, since by definition no termination cause was recorded for that case.
export const INTERRUPTED_STATUS: TerminalStatus = "interrupted";

const CANCELLED_CAUSES = new Set<TerminationCause>([
	"user_kill",
	"agent_kill",
	"quiet_auto_exit",
	"monitor_stop",
	"shutdown",
]);

/**
 * Legacy DispatchResult fields, derived from `cause`, not from `status`, so
 * the public tool result stays byte-compatible with what old callers expect.
 */
export function legacyFields(t: Termination): { cancelled: boolean; timedOut: boolean; exitCode: number | null } {
	return {
		cancelled: CANCELLED_CAUSES.has(t.cause),
		timedOut: t.cause === "timeout",
		exitCode: t.sentinelExitCode ?? t.exitCode,
	};
}
