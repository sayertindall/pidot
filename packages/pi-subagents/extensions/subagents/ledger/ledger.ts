/**
 * ledger.ts — Subagent spawn and result ledger
 *
 * Append-only JSONL ledger tracking every subagent the parent spawns.
 * Supports reconciliation on session restart — find orphaned children,
 * collect results from completed runs, and detect crashes.
 *
 * Format (one line per event):
 *   {"type":"spawn","runId":"...","parentKey":"...","childSessionId":"...",...}
 *   {"type":"status","runId":"...","status":"completed",...}
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const LEDGER_DIR = join(homedir(), ".pi", "agent", "pi-subagents");
const LEDGER_FILE = join(LEDGER_DIR, "ledger.jsonl");

// ─── Types ────────────────────────────────────────────────────────

export type LedgerStatus = "running" | "completed" | "failed" | "crashed";

export interface LedgerSpawnEntry {
	type: "spawn";
	runId: string;
	parentKey: string;
	childSessionId: string;
	childSocket: string;
	agentName: string;
	task: string;
	spawnedAt: number;
	status: LedgerStatus;
}

export interface LedgerStatusEntry {
	type: "status";
	runId: string;
	status: LedgerStatus;
	timestamp: number;
}

export type LedgerEntry = LedgerSpawnEntry | LedgerStatusEntry;

// ─── Write ────────────────────────────────────────────────────────

async function ensureLedgerDir(): Promise<void> {
	await mkdir(LEDGER_DIR, { recursive: true });
}

export async function writeSpawn(
	entry: Omit<LedgerSpawnEntry, "type" | "status"> & { status?: LedgerStatus },
): Promise<void> {
	await ensureLedgerDir();
	const line: LedgerSpawnEntry = {
		type: "spawn",
		...entry,
		status: entry.status ?? "running",
	};
	await appendFile(LEDGER_FILE, JSON.stringify(line) + "\n", "utf8");
}

export async function writeStatusChange(
	runId: string,
	status: LedgerStatus,
): Promise<void> {
	await ensureLedgerDir();
	const line: LedgerStatusEntry = {
		type: "status",
		runId,
		status,
		timestamp: Date.now(),
	};
	await appendFile(LEDGER_FILE, JSON.stringify(line) + "\n", "utf8");
}

// ─── Read ─────────────────────────────────────────────────────────

export interface ResolvedLedgerEntry {
	runId: string;
	parentKey: string;
	childSessionId: string;
	childSocket: string;
	agentName: string;
	task: string;
	spawnedAt: number;
	status: LedgerStatus;
	statusChangedAt: number;
}

export async function readLedger(
	parentKey: string,
): Promise<Map<string, ResolvedLedgerEntry>> {
	const grouped = new Map<string, ResolvedLedgerEntry>();

	let content: string;
	try {
		content = await readFile(LEDGER_FILE, "utf8");
	} catch {
		return grouped;
	}

	for (const line of content.split("\n")) {
		if (!line.trim()) continue;

		let entry: LedgerEntry;
		try {
			entry = JSON.parse(line) as LedgerEntry;
		} catch {
			continue;
		}

		if (entry.type === "spawn") {
			const spawn = entry as LedgerSpawnEntry;
			if (spawn.parentKey !== parentKey) continue;

			grouped.set(spawn.runId, {
				runId: spawn.runId,
				parentKey: spawn.parentKey,
				childSessionId: spawn.childSessionId,
				childSocket: spawn.childSocket,
				agentName: spawn.agentName,
				task: spawn.task,
				spawnedAt: spawn.spawnedAt,
				status: spawn.status,
				statusChangedAt: spawn.spawnedAt,
			});
		} else if (entry.type === "status") {
			const status = entry as LedgerStatusEntry;
			const existing = grouped.get(status.runId);
			if (existing) {
				existing.status = status.status;
				existing.statusChangedAt = status.timestamp;
			}
		}
	}

	return grouped;
}

// ─── Reconciliation ───────────────────────────────────────────────

export interface ReconciliationResult {
	reconnected: string[];  // runIds that were still running and reconnected
	collected: string[];    // runIds that finished while parent was away
	crashed: string[];      // runIds that died without results
}

export async function reconcilePersistedChildren(
	parentKey: string,
): Promise<ReconciliationResult> {
	const result: ReconciliationResult = {
		reconnected: [],
		collected: [],
		crashed: [],
	};

	const entries = await readLedger(parentKey);
	if (entries.size === 0) return result;

	// Dynamic import to avoid hard dependency on session-control
	const { getSocketPath, isSocketAlive: isAlive } = await import(
		"../../../../pi-toolkit/session-control/extensions/session-control/registry"
	);

	for (const [runId, entry] of entries) {
		if (entry.status !== "running") continue;

		const socketPath = entry.childSocket || getSocketPath(entry.childSessionId);
		const alive = await isAlive(socketPath);

		if (alive) {
			result.reconnected.push(runId);
		} else {
			// Check for result file
			const { existsSync } = await import("node:fs");
			const resultsDir = join(homedir(), ".pi", "agent", "pi-subagents", "results");
			const resultFile = join(resultsDir, `${runId}.json`);

			if (existsSync(resultFile)) {
				result.collected.push(runId);
				await writeStatusChange(runId, "completed");
			} else {
				result.crashed.push(runId);
				await writeStatusChange(runId, "crashed");
			}
		}
	}

	return result;
}

// ─── Collected Tracking ───────────────────────────────────────────

const COLLECTED_FILE = join(LEDGER_DIR, "collected.json");

interface CollectedData {
	[key: string]: string[]; // parentKey → runId[]
}

let collectedCache: CollectedData | null = null;

async function readCollected(): Promise<CollectedData> {
	if (collectedCache) return collectedCache;
	try {
		const raw = await readFile(COLLECTED_FILE, "utf8");
		collectedCache = JSON.parse(raw) as CollectedData;
		return collectedCache!;
	} catch {
		collectedCache = {};
		return {};
	}
}

async function writeCollected(data: CollectedData): Promise<void> {
	await ensureLedgerDir();
	await import("node:fs/promises").then((fs) =>
		fs.writeFile(COLLECTED_FILE, JSON.stringify(data, null, 2), "utf8"),
	);
	collectedCache = data;
}

export async function markCollected(
	parentKey: string,
	runId: string,
): Promise<void> {
	const data = await readCollected();
	const runs = data[parentKey] ?? [];
	if (!runs.includes(runId)) {
		runs.push(runId);
		data[parentKey] = runs;
		await writeCollected(data);
	}
}

export async function isCollected(
	parentKey: string,
	runId: string,
): Promise<boolean> {
	const data = await readCollected();
	return (data[parentKey] ?? []).includes(runId);
}
