/**
 * ledger.test.ts — Ledger I/O, reconciliation, and collected tracking
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We test the actual module but redirect its file paths by mocking homedir.
// The ledger writes to ~/.pi/agent/pi-subagents/ — in tests, we use a temp dir.

// Mock homedir — must be at module scope before imports
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: () => tmpdir(),
	};
});

// Override the ledger paths by setting the actual paths to our temp dir.
// The ledger module resolves paths from homedir() + ".pi/agent/pi-subagents/"
// which will now be our temp dir + ".pi/agent/pi-subagents/".
const ACTUAL_LEDGER_DIR = join(tmpdir(), ".pi", "agent", "pi-subagents");
const ACTUAL_LEDGER_FILE = join(ACTUAL_LEDGER_DIR, "ledger.jsonl");
const ACTUAL_COLLECTED_FILE = join(ACTUAL_LEDGER_DIR, "collected.json");
const ACTUAL_RESULTS_DIR = join(ACTUAL_LEDGER_DIR, "results");

import {
	writeSpawn,
	writeStatusChange,
	readLedger,
	reconcilePersistedChildren,
	markCollected,
	isCollected,
} from "../extensions/subagents/ledger/ledger";

beforeEach(() => {
	rmSync(ACTUAL_LEDGER_DIR, { recursive: true, force: true });
	mkdirSync(ACTUAL_LEDGER_DIR, { recursive: true });
	mkdirSync(ACTUAL_RESULTS_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(ACTUAL_LEDGER_DIR, { recursive: true, force: true });
});

// ─── writeSpawn + writeStatusChange ────────────────────────────

describe("writeSpawn", () => {
	it("writes a spawn entry to the ledger", async () => {
		await writeSpawn({
			runId: "run-001",
			parentKey: "pk_test",
			childSessionId: "child-abc",
			childSocket: "/tmp/child.sock",
			agentName: "finder",
			task: "locate auth code",
			spawnedAt: 1700000000000,
		});

		const content = readFileSync(ACTUAL_LEDGER_FILE, "utf8");
		const lines = content.trim().split("\n");
		expect(lines.length).toBe(1);

		const entry = JSON.parse(lines[0]!);
		expect(entry.type).toBe("spawn");
		expect(entry.runId).toBe("run-001");
		expect(entry.status).toBe("running");
		expect(entry.agentName).toBe("finder");
	});

	it("accepts explicit status override", async () => {
		await writeSpawn({
			runId: "run-002",
			parentKey: "pk_test",
			childSessionId: "child-def",
			childSocket: "/tmp/child2.sock",
			agentName: "worker",
			task: "refactor",
			spawnedAt: 1700000001000,
			status: "completed",
		});

		const content = readFileSync(ACTUAL_LEDGER_FILE, "utf8");
		const entry = JSON.parse(content.trim());
		expect(entry.status).toBe("completed");
	});
});

describe("writeStatusChange", () => {
	it("appends a status change entry after a spawn", async () => {
		await writeSpawn({
			runId: "run-003",
			parentKey: "pk_test",
			childSessionId: "child-ghi",
			childSocket: "/tmp/child3.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1700000002000,
		});

		await writeStatusChange("run-003", "completed");

		const content = readFileSync(ACTUAL_LEDGER_FILE, "utf8");
		const lines = content.trim().split("\n");
		expect(lines.length).toBe(2);

		const statusEntry = JSON.parse(lines[1]!);
		expect(statusEntry.type).toBe("status");
		expect(statusEntry.runId).toBe("run-003");
		expect(statusEntry.status).toBe("completed");
		expect(typeof statusEntry.timestamp).toBe("number");
	});
});

// ─── readLedger ─────────────────────────────────────────────────

describe("readLedger", () => {
	it("returns empty map when ledger doesn't exist", async () => {
		const entries = await readLedger("nonexistent");
		expect(entries.size).toBe(0);
	});

	it("groups entries by runId with latest status", async () => {
		await writeSpawn({
			runId: "run-010",
			parentKey: "pk_test",
			childSessionId: "child-1",
			childSocket: "/tmp/s1.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
		});
		await writeStatusChange("run-010", "completed");

		const entries = await readLedger("pk_test");
		expect(entries.size).toBe(1);

		const entry = entries.get("run-010");
		expect(entry).toBeDefined();
		expect(entry!.status).toBe("completed");
		expect(entry!.agentName).toBe("finder");
	});

	it("filters by parentKey", async () => {
		await writeSpawn({
			runId: "run-020",
			parentKey: "pk_alpha",
			childSessionId: "child-a",
			childSocket: "/tmp/sa.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
		});
		await writeSpawn({
			runId: "run-021",
			parentKey: "pk_beta",
			childSessionId: "child-b",
			childSocket: "/tmp/sb.sock",
			agentName: "worker",
			task: "build",
			spawnedAt: 2000,
		});

		const alpha = await readLedger("pk_alpha");
		expect(alpha.size).toBe(1);
		expect(alpha.get("run-020")!.agentName).toBe("finder");

		const beta = await readLedger("pk_beta");
		expect(beta.size).toBe(1);
		expect(beta.get("run-021")!.agentName).toBe("worker");
	});

	it("handles multiple status changes (last wins)", async () => {
		await writeSpawn({
			runId: "run-030",
			parentKey: "pk_test",
			childSessionId: "child-c",
			childSocket: "/tmp/sc.sock",
			agentName: "worker",
			task: "build",
			spawnedAt: 1000,
		});
		await writeStatusChange("run-030", "running");
		await writeStatusChange("run-030", "failed");
		await writeStatusChange("run-030", "crashed");

		const entries = await readLedger("pk_test");
		expect(entries.get("run-030")!.status).toBe("crashed");
	});

	it("ignores malformed JSON lines", async () => {
		writeFileSync(ACTUAL_LEDGER_FILE, '{"type":"spawn","runId":"garbage\nnot json\n');
		const entries = await readLedger("pk_test");
		expect(entries.size).toBe(1);
	});
});

// ─── Collected Tracking ─────────────────────────────────────────

describe("markCollected / isCollected", () => {
	it("marks and checks a collected run", async () => {
		expect(await isCollected("pk_test", "run-100")).toBe(false);
		await markCollected("pk_test", "run-100");
		expect(await isCollected("pk_test", "run-100")).toBe(true);
	});

	it("does not duplicate entries", async () => {
		await markCollected("pk_test", "run-100");
		await markCollected("pk_test", "run-100");
		await markCollected("pk_test", "run-100");

		const raw = JSON.parse(readFileSync(ACTUAL_COLLECTED_FILE, "utf8"));
		expect(raw["pk_test"]).toEqual(["run-100"]);
	});

	it("tracks multiple keys independently", async () => {
		await markCollected("pk_alpha", "run-1");
		await markCollected("pk_beta", "run-2");

		expect(await isCollected("pk_alpha", "run-1")).toBe(true);
		expect(await isCollected("pk_alpha", "run-2")).toBe(false);
		expect(await isCollected("pk_beta", "run-2")).toBe(true);
	});
});

// ─── Reconciliation ─────────────────────────────────────────────

describe("reconcilePersistedChildren", () => {
	it("returns empty when no entries exist", async () => {
		const result = await reconcilePersistedChildren("pk_empty");
		expect(result.reconnected).toEqual([]);
		expect(result.collected).toEqual([]);
		expect(result.crashed).toEqual([]);
	});

	it("returns empty when no running entries", async () => {
		await writeSpawn({
			runId: "run-200",
			parentKey: "pk_rec",
			childSessionId: "child",
			childSocket: "/tmp/nonexistent.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
			status: "completed",
		});

		const result = await reconcilePersistedChildren("pk_rec");
		expect(result.reconnected).toEqual([]);
		expect(result.collected).toEqual([]);
		expect(result.crashed).toEqual([]);
	});

	it("detects crashed children (no socket, no result file)", async () => {
		await writeSpawn({
			runId: "run-201",
			parentKey: "pk_rec",
			childSessionId: "child-dead",
			childSocket: "/tmp/nonexistent.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
			status: "running",
		});

		const result = await reconcilePersistedChildren("pk_rec");
		expect(result.crashed).toContain("run-201");
		expect(result.collected).toEqual([]);
	});

	it("detects collected children (no socket, result file exists)", async () => {
		await writeSpawn({
			runId: "run-202",
			parentKey: "pk_rec",
			childSessionId: "child-done",
			childSocket: "/tmp/nonexistent.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
			status: "running",
		});

		// Write a fake result file
		writeFileSync(join(ACTUAL_RESULTS_DIR, "run-202.json"), JSON.stringify({ status: "completed" }));

		const result = await reconcilePersistedChildren("pk_rec");
		expect(result.collected).toContain("run-202");
		expect(result.crashed).toEqual([]);
	});

	it("updates ledger status after reconciliation", async () => {
		await writeSpawn({
			runId: "run-203",
			parentKey: "pk_rec",
			childSessionId: "child-done2",
			childSocket: "/tmp/nonexistent.sock",
			agentName: "finder",
			task: "search",
			spawnedAt: 1000,
			status: "running",
		});

		writeFileSync(join(ACTUAL_RESULTS_DIR, "run-203.json"), JSON.stringify({ status: "completed" }));

		await reconcilePersistedChildren("pk_rec");

		const entries = await readLedger("pk_rec");
		expect(entries.get("run-203")!.status).toBe("completed");
	});
});
