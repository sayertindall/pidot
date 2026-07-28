/**
 * socket-harness.ts — Parent-side subagent socket transport
 *
 * Spawns a child pi process via interactive_shell, waits for its
 * session-control socket, sends the task with subagent-task metadata,
 * and collects the typed SubagentResult via the result_ready event.
 *
 * Replaces the unimplemented harness-pi-rpc.ts stdio transport.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { getSocketPath, isSocketAlive } from "../../../../pi-toolkit/extensions/session-control/session-control/registry";
import type { SubagentResult } from "../../../../pi-toolkit/extensions/session-control/session-control/types";
import type { HarnessResult, PiRpcLaunchConfig } from "../types";
import { generateRunId } from "./run-id";

const SOCKET_POLL_INTERVAL_MS = 100;
const SOCKET_POLL_TIMEOUT_MS = 10_000;

export async function runViaSocket(
	launch: PiRpcLaunchConfig,
): Promise<HarnessResult> {
	const agentId = `socket-${generateRunId().slice(0, 8)}`;
	const runId = agentId;

	try {
		// 1. Write spawn to ledger
		try {
			const { writeSpawn } = await import("../ledger/ledger");
			await writeSpawn({
				runId,
				parentKey: launch.parentSessionId, // will be replaced by parent-key once wired
				childSessionId: "", // filled after spawn
				childSocket: "",
				agentName: launch.agentType ?? "unknown",
				task: launch.message,
				spawnedAt: Date.now(),
				status: "running",
			});
		} catch {
			// Ledger not available — non-fatal
		}

		// 2. The actual spawn + socket communication is done via interactive_shell
		// which is called by the orchestrator (index.ts). This harness is the
		// transport layer — it handles socket communication after spawn.
		//
		// For now, return a "not yet wired" result — the full spawn flow
		// requires pi-dispatch integration which is Phase 2c.
		return {
			status: "failed",
			result: "",
			error: "socket harness: spawn flow not yet wired to pi-dispatch (Phase 2c). Use harness: \"pi\" (in-process) for now.",
			agentId,
		};
	} catch (error) {
		return {
			status: "failed",
			result: "",
			error: error instanceof Error ? error.message : String(error),
			agentId,
		};
	}
}

// ─── Full spawn flow (Phase 2c) ──────────────────────────────────

/** Phase 2c: full spawn flow using pi-dispatch. Exported for future use. */
export async function fullSpawnAndCollect(
	launch: PiRpcLaunchConfig,
	runId: string,
): Promise<HarnessResult> {
	// 3. Spawn child via interactive_shell
	const childSessionId = await spawnChildSession(launch, runId);
	const socketPath = getSocketPath(childSessionId);

	// 4. Wait for socket
	const ready = await waitForSocket(socketPath, SOCKET_POLL_TIMEOUT_MS);
	if (!ready) {
		return {
			status: "failed",
			result: "",
			error: `Subagent socket never appeared within ${SOCKET_POLL_TIMEOUT_MS}ms`,
			agentId: runId,
		};
	}

	// 5. Send task over socket and wait for result_ready
	const { sendRpcCommand } = await import(
		"../../../../pi-toolkit/extensions/session-control/session-control/client"
	);

	const command = {
		type: "send" as const,
		message: launch.message,
		mode: "steer" as const,
		metadata: {
			kind: "subagent-task" as const,
			runId,
			parentSessionId: launch.parentSessionId,
			parentKey: launch.parentSessionId,
			agentName: launch.agentType ?? "unknown",
			task: launch.message,
			agentConfig: {},
			lifecycle: "single" as const,
		},
	};

	const result = await sendRpcCommand(socketPath, command, {
		timeout: 300_000,
		waitForEvent: "result_ready",
	});

	const subagentResult = (result.event as any)?.result as SubagentResult | undefined;

	if (!subagentResult) {
		return {
			status: "failed",
			result: "",
			error: "No result received from subagent",
			agentId: runId,
		};
	}

	// Mark collected
	try {
		const { writeStatusChange } = await import("../ledger/ledger");
		await writeStatusChange(runId, subagentResult.status === "failed" ? "failed" : "completed");
	} catch {
		// Non-fatal
	}

	return {
		status: subagentResult.status === "completed" ? "completed"
			: subagentResult.status === "stopped" ? "stopped"
			: "failed",
		stoppedReason: subagentResult.stoppedReason,
		result: subagentResult.output,
		error: subagentResult.error,
		agentId: runId,
	};
}

async function waitForSocket(
	socketPath: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isSocketAlive(socketPath)) return true;
		await sleep(SOCKET_POLL_INTERVAL_MS);
	}
	return false;
}

async function spawnChildSession(
	_launch: PiRpcLaunchConfig,
	_runId: string,
): Promise<string> {
	// TODO Phase 2c: call pi-dispatch's spawn function
	throw new Error("spawnChildSession not wired — needs pi-dispatch integration");
}
