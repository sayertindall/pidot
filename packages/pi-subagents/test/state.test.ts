import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScheduleStore, resolveStorePath } from "../extensions/subagents/state.ts";
import type { ScheduledSubagent } from "../extensions/subagents/types.ts";

function fixtureJob(overrides: Partial<ScheduledSubagent> = {}): ScheduledSubagent {
	return {
		id: "job-1",
		name: "nightly-report",
		description: "Summarize open PRs",
		schedule: "0 0 9 * * 1",
		scheduleType: "cron",
		subagentType: "general-purpose",
		prompt: "Summarize open PRs",
		enabled: true,
		createdAt: new Date().toISOString(),
		runCount: 0,
		...overrides,
	};
}

describe("resolveStorePath", () => {
	it("builds <cwd>/.pi/subagent-schedules/<sessionId>.json", () => {
		expect(resolveStorePath("/repo", "sess-123")).toBe(join("/repo", ".pi", "subagent-schedules", "sess-123.json"));
	});
});

describe("ScheduleStore", () => {
	let dir: string;
	let filePath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-subagents-state-"));
		filePath = join(dir, "store.json");
	});

	afterEach(() => {
		// mkdtempSync dirs are left for the OS temp cleanup; nothing to do here
		// since we never write outside `dir`.
	});

	it("add() then list() round-trips a job through a fresh store instance", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob());

		const reloaded = new ScheduleStore(filePath);
		const jobs = reloaded.list();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			id: "job-1",
			name: "nightly-report",
			scheduleType: "cron",
			subagentType: "general-purpose",
		});
	});

	it("persists on-disk keys as snake_case, not camelCase", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob({ maxTurns: 5, intervalMs: 60_000 }));

		const raw = JSON.parse(readFileSync(filePath, "utf-8"));
		const job = raw.jobs[0];
		expect(job).toHaveProperty("schedule_type", "cron");
		expect(job).toHaveProperty("subagent_type", "general-purpose");
		expect(job).toHaveProperty("created_at");
		expect(job).toHaveProperty("run_count", 0);
		expect(job).toHaveProperty("max_turns", 5);
		expect(job).toHaveProperty("interval_ms", 60_000);
		expect(job).not.toHaveProperty("scheduleType");
		expect(job).not.toHaveProperty("subagentType");
	});

	it("update() patches an existing job and persists the patch", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob());
		const updated = store.update("job-1", { enabled: false, lastStatus: "success", runCount: 1 });
		expect(updated?.enabled).toBe(false);

		const reloaded = new ScheduleStore(filePath);
		expect(reloaded.get("job-1")?.enabled).toBe(false);
		expect(reloaded.get("job-1")?.runCount).toBe(1);
	});

	it("update() on an unknown id is a no-op and never creates the backing file", () => {
		const store = new ScheduleStore(filePath);
		expect(store.update("nope", { enabled: false })).toBeUndefined();
		expect(existsSync(filePath)).toBe(false);
	});

	it("remove() deletes a job; unknown id is a no-op returning false", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob());
		expect(store.remove("does-not-exist")).toBe(false);
		expect(store.remove("job-1")).toBe(true);
		expect(store.list()).toHaveLength(0);
	});

	it("hasName() checks uniqueness, optionally excluding one id", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob());
		expect(store.hasName("nightly-report")).toBe(true);
		expect(store.hasName("nightly-report", "job-1")).toBe(false);
		expect(store.hasName("something-else")).toBe(false);
	});

	it("quarantines an unparseable file instead of silently discarding it", () => {
		writeFileSync(filePath, "{ not valid json");
		const store = new ScheduleStore(filePath);
		expect(store.list()).toHaveLength(0);

		const siblings = readdirSync(dir);
		expect(siblings.some((f) => f.startsWith("store.json.corrupt-"))).toBe(true);
	});

	it("quarantines a schema-invalid (but parseable) file instead of silently discarding it", () => {
		writeFileSync(filePath, JSON.stringify({ version: 1, jobs: [{ totally: "wrong shape" }] }));
		const store = new ScheduleStore(filePath);
		expect(store.list()).toHaveLength(0);

		const siblings = readdirSync(dir);
		expect(siblings.some((f) => f.startsWith("store.json.corrupt-"))).toBe(true);
	});

	it("deleteFileIfEmpty() removes the backing file only when no jobs remain", () => {
		const store = new ScheduleStore(filePath);
		store.add(fixtureJob());
		store.deleteFileIfEmpty();
		expect(existsSync(filePath)).toBe(true);

		store.remove("job-1");
		store.deleteFileIfEmpty();
		expect(existsSync(filePath)).toBe(false);
	});
});
