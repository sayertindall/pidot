/**
 * subagent-runner.ts — Child-side subagent task executor
 *
 * Runs when the session-control server receives a `send` with
 * metadata.kind === "subagent-task". Deserializes the agent config,
 * runs the agent using pi-subagents' runAgent(), captures a typed
 * SubagentResult, writes it to disk, and emits result_ready.
 *
 * Write-then-emit ordering: result file is written BEFORE the event
 * fires, so subscribers can read it immediately.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fireResultReadyEvents } from "./message-handler";
import type { SocketState, SubagentResult, SubagentTaskMetadata } from "./types";

const RESULTS_DIR = join(homedir(), ".pi", "agent", "pi-subagents", "results");

export async function runSubagentTask(
	_pi: ExtensionAPI,
	ctx: ExtensionContext,
	metadata: SubagentTaskMetadata,
	state: SocketState,
): Promise<void> {
	let toolCount = 0;
	let turnCount = 0;
	let lastResponseText = "";
	const tokenUsages: Array<{ input: number; output: number; cacheWrite: number }> = [];

	try {
		// Dynamically import runAgent from pi-subagents to avoid hard dependency
		const { runAgent } = await import(
			"../../../../pi-subagents/extensions/subagents/session-runner"
		);

		const agentConfig = metadata.agentConfig as Record<string, unknown>;

		const result = await runAgent(
			ctx,
			(agentConfig.name as string) ?? metadata.agentName,
			metadata.task,
			{
				agentConfig: agentConfig as any,
				cwd: ctx.cwd,
				configCwd: ctx.cwd,
				signal: ctx.signal ?? undefined,
				onToolActivity: (activity) => {
					if (activity.type === "start") toolCount++;
				},
				onTurnEnd: () => {
					turnCount++;
				},
				onTextDelta: (_delta, fullText) => {
					lastResponseText = fullText;
				},
				onAssistantUsage: (usage) => {
					tokenUsages.push(usage);
				},
			},
		);

		const finalText = lastResponseText || result.responseText || "";

		// Build structured result
		const subagentResult: SubagentResult = {
			runId: metadata.runId,
			status: result.failure
				? "failed"
				: result.aborted
					? "stopped"
					: "completed",
			stoppedReason: result.aborted ? "turn-limit" : undefined,
			output: finalText,
			toolCount,
			turnCount,
			tokenUsage: tokenUsages.length > 0
				? {
						input: tokenUsages.reduce((s, u) => s + (u.input ?? 0), 0),
						output: tokenUsages.reduce((s, u) => s + (u.output ?? 0), 0),
						cacheCreation: tokenUsages.reduce((s, u) => s + (u.cacheWrite ?? 0), 0),
						cacheRead: 0,
					}
				: undefined,
			error: result.failure,
			agentName: metadata.agentName,
			modelUsed: (agentConfig.model as string) ?? "unknown",
		};

		// Write canonical result file BEFORE emitting event
		await writeResultFile(metadata.runId, subagentResult);

		// Write ledger status change
		try {
			const { writeStatusChange } = await import(
				"../../../../pi-subagents/extensions/subagents/ledger/ledger"
			);
			await writeStatusChange(metadata.runId, "completed");
		} catch {
			// Ledger module not available yet — non-fatal
		}

		// Emit result_ready to all subscribers
		fireResultReadyEvents(state, subagentResult);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		const failedResult: SubagentResult = {
			runId: metadata.runId,
			status: "failed",
			output: "",
			toolCount,
			turnCount,
			error: errorMessage,
			agentName: metadata.agentName,
			modelUsed: "unknown",
		};

		try {
			await writeResultFile(metadata.runId, failedResult);
		} catch {
			// Best effort
		}

		fireResultReadyEvents(state, failedResult);
	} finally {
		// If this is a one-shot subagent (not a pool worker), shut down
		if (metadata.lifecycle === "single") {
			try {
				ctx.shutdown();
			} catch {
				// Session may already be shutting down
			}
		}
	}
}

async function writeResultFile(
	runId: string,
	result: SubagentResult,
): Promise<void> {
	await mkdir(RESULTS_DIR, { recursive: true });
	const path = join(RESULTS_DIR, `${runId}.json`);
	const payload = {
		...result,
		completedAt: Date.now(),
	};
	await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}
