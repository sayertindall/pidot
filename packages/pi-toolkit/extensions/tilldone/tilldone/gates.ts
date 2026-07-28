/**
 * pi-toolkit-tilldone — gates
 *
 * Gate enforcement: block agent when tasks aren't defined or no task is
 * in-progress. Run shell command gates before marking a task done.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Task, TillDoneState } from "./types";

/**
 * Returns true if the agent should be blocked before starting.
 * Block reasons:
 *   - enabled && no tasks defined
 *   - enabled && no task is in_progress
 *   - enabled && all tasks done
 */
export function shouldBlockAgentStart(
	state: TillDoneState,
): { block: boolean; reason?: string } {
	if (!state.enabled) return { block: false };
	if (state.tasks.length === 0) {
		return {
			block: true,
			reason:
				"[Task Mode] No tasks defined. Use `tilldone add` to define tasks before using other tools.",
		};
	}
	const pending = state.tasks.filter((t) => t.status !== "done");
	if (pending.length === 0) {
		return {
			block: true,
			reason:
				"[Task Mode] All tasks are done. Use `tilldone add` for new tasks.",
		};
	}
	if (!state.tasks.some((t) => t.status === "inprogress")) {
		return {
			block: true,
			reason:
				"[Task Mode] No task is in progress. Use `tilldone next` to mark a task as in-progress before doing any work.",
		};
	}
	return { block: false };
}

/**
 * Run a shell gate command. Returns { passed: true } on exit 0.
 */
export async function runGate(
	gate: string,
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<{ passed: boolean; stdout: string; stderr: string }> {
	try {
		const result = await pi.exec("sh", ["-c", gate], { signal });
		return {
			passed: result.code === 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { passed: false, stdout: "", stderr: msg };
	}
}

/** Returns true if a task has a gate command defined. */
export function isTaskGated(task: Task): boolean {
	return typeof task.gate === "string" && task.gate.trim().length > 0;
}
