/**
 * state.ts — File-backed store for scheduled subagents.
 *
 * Session-scoped: each pi session owns its own schedules at
 * `<cwd>/.pi/subagent-schedules/<sessionId>.json`. `/new` starts a fresh
 * empty store; `/resume` reloads.
 *
 * Concurrency model ported from the reference `schedule-store.ts`: every
 * mutation acquires a PID-based exclusion lock, re-reads the latest state
 * from disk, applies the change, atomic-writes via temp+rename, releases.
 * See SUB-SPEC-v4.md §3.1.
 *
 * Two [FIX]es on top of the reference:
 *  1. On-disk keys are snake_case (schema.ts's ScheduleStoreDiskSchema);
 *     in-memory stays camelCase (types.ts's ScheduledSubagent). This module
 *     is the only place that translates between the two, via toDisk()/
 *     fromDisk(). The parsed JSON is also validated against
 *     ScheduleStoreDiskSchema with Value.Check before being trusted.
 *  2. A corrupt or schema-invalid file is moved aside to
 *     `<path>.corrupt-<timestamp>` before starting fresh, instead of being
 *     silently discarded (the reference's `load()` just swallows the parse
 *     error and starts empty).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Value } from "typebox/value";
import { ScheduleStoreDiskSchema } from "./schema.ts";
import type { ScheduledSubagent, ScheduleStoreData } from "./types.ts";

const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100;

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function acquireLock(lockPath: string): void {
	for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
		try {
			writeFileSync(lockPath, `${process.pid}`, { flag: "wx" });
			return;
		} catch (e: any) {
			if (e.code === "EEXIST") {
				try {
					const pid = parseInt(readFileSync(lockPath, "utf-8"), 10);
					if (pid && !isProcessRunning(pid)) {
						unlinkSync(lockPath);
						continue;
					}
				} catch {
					/* ignore — try again */
				}
				const start = Date.now();
				while (Date.now() - start < LOCK_RETRY_MS) {
					/* busy wait */
				}
				continue;
			}
			throw e;
		}
	}
	throw new Error(`Failed to acquire schedule lock: ${lockPath}`);
}

function releaseLock(lockPath: string): void {
	try {
		unlinkSync(lockPath);
	} catch {
		/* ignore */
	}
}

/** Move a corrupt or schema-invalid file aside instead of silently discarding it. [FIX] */
function quarantineCorrupt(path: string): void {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	try {
		renameSync(path, `${path}.corrupt-${stamp}`);
	} catch {
		// best-effort — a failed move must not crash startup
	}
}

/** Resolve the storage path for a session-scoped store. */
export function resolveStorePath(cwd: string, sessionId: string): string {
	return join(cwd, ".pi", "subagent-schedules", `${sessionId}.json`);
}

// --- on-disk (snake_case) <-> in-memory (camelCase) translation [FIX] ---

function toDisk(job: ScheduledSubagent): unknown {
	return {
		id: job.id,
		name: job.name,
		description: job.description,
		schedule: job.schedule,
		schedule_type: job.scheduleType,
		interval_ms: job.intervalMs,

		subagent_type: job.subagentType,
		prompt: job.prompt,
		model: job.model,
		thinking: job.thinking,
		max_turns: job.maxTurns,
		isolated: job.isolated,
		isolation: job.isolation,

		enabled: job.enabled,
		created_at: job.createdAt,
		last_run: job.lastRun,
		last_status: job.lastStatus,
		next_run: job.nextRun,
		run_count: job.runCount,
	};
}

function fromDisk(raw: unknown): ScheduledSubagent {
	const d = raw as Record<string, unknown>;
	return {
		id: d.id as string,
		name: d.name as string,
		description: d.description as string,
		schedule: d.schedule as string,
		scheduleType: d.schedule_type as ScheduledSubagent["scheduleType"],
		intervalMs: d.interval_ms as number | undefined,

		subagentType: d.subagent_type as string,
		prompt: d.prompt as string,
		model: d.model as string | undefined,
		thinking: d.thinking as ScheduledSubagent["thinking"],
		maxTurns: d.max_turns as number | undefined,
		isolated: d.isolated as boolean | undefined,
		isolation: d.isolation as ScheduledSubagent["isolation"],

		enabled: d.enabled as boolean,
		createdAt: d.created_at as string,
		lastRun: d.last_run as string | undefined,
		lastStatus: d.last_status as ScheduledSubagent["lastStatus"],
		nextRun: d.next_run as string | undefined,
		runCount: d.run_count as number,
	};
}

export class ScheduleStore {
	private filePath: string;
	private lockPath: string;
	private jobs = new Map<string, ScheduledSubagent>();

	constructor(filePath: string) {
		this.filePath = filePath;
		this.lockPath = filePath + ".lock";
		this.load();
	}

	/** Create the backing directory lazily — only when we're about to persist. */
	private ensureDir(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
	}

	/**
	 * Load from disk into the in-memory cache. A JSON parse failure or a
	 * schema-invalid payload is treated as corruption: the file is moved
	 * aside to `<path>.corrupt-<timestamp>` (never silently dropped) and the
	 * cache starts fresh — the next save() rewrites it. [FIX]
	 */
	private load(): void {
		if (!existsSync(this.filePath)) return;
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(this.filePath, "utf-8"));
		} catch {
			quarantineCorrupt(this.filePath);
			return;
		}
		if (!Value.Check(ScheduleStoreDiskSchema, raw)) {
			quarantineCorrupt(this.filePath);
			return;
		}
		const data = raw as { version: 1; jobs: unknown[] };
		this.jobs.clear();
		for (const j of data.jobs ?? []) {
			const job = fromDisk(j);
			this.jobs.set(job.id, job);
		}
	}

	/** Atomic write via temp file + rename (POSIX-atomic). */
	private save(): void {
		const data = { version: 1 as const, jobs: [...this.jobs.values()].map(toDisk) };
		const tmp = this.filePath + ".tmp";
		writeFileSync(tmp, JSON.stringify(data, null, 2));
		renameSync(tmp, this.filePath);
	}

	/** Acquire lock → reload → mutate → save → release. */
	private withLock<T>(fn: () => T): T {
		this.ensureDir();
		acquireLock(this.lockPath);
		try {
			this.load();
			const result = fn();
			this.save();
			return result;
		} finally {
			releaseLock(this.lockPath);
		}
	}

	/** Read-only — returns a snapshot of the in-memory cache. */
	list(): ScheduledSubagent[] {
		return [...this.jobs.values()];
	}

	/** Read-only check — uses the cache. */
	hasName(name: string, exceptId?: string): boolean {
		for (const j of this.jobs.values()) {
			if (j.id !== exceptId && j.name === name) return true;
		}
		return false;
	}

	get(id: string): ScheduledSubagent | undefined {
		return this.jobs.get(id);
	}

	add(job: ScheduledSubagent): void {
		this.withLock(() => {
			this.jobs.set(job.id, job);
		});
	}

	update(id: string, patch: Partial<ScheduledSubagent>): ScheduledSubagent | undefined {
		// No-op fast path — an unknown id changes nothing, so don't lock or touch
		// disk (which would otherwise lazily create the backing directory).
		if (!this.jobs.has(id)) return undefined;
		return this.withLock(() => {
			const existing = this.jobs.get(id);
			if (!existing) return undefined;
			const updated = { ...existing, ...patch };
			this.jobs.set(id, updated);
			return updated;
		});
	}

	remove(id: string): boolean {
		// No-op fast path — see update().
		if (!this.jobs.has(id)) return false;
		return this.withLock(() => this.jobs.delete(id));
	}

	/** Delete the backing file (used when no jobs remain, optional cleanup). */
	deleteFileIfEmpty(): void {
		if (this.jobs.size === 0 && existsSync(this.filePath)) {
			try {
				unlinkSync(this.filePath);
			} catch {
				/* ignore */
			}
		}
	}
}

// Re-exported for callers that want the in-memory store-data shape without
// reaching into types.ts directly (e.g. tests constructing fixtures).
export type { ScheduleStoreData };
