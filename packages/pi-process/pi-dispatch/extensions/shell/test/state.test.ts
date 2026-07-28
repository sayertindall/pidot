import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mutable container so the mock closure sees per-test updates
const mockState = vi.hoisted(() => ({ dir: "/tmp/mock-agent-dir" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mockState.dir,
	withFileMutationQueue: async (_path: string, fn: () => Promise<any>) => fn(),
}));

import { createRunRecord, mutateRunRecord, getRunRecord, findBySessionId, getIndex, deleteRunRecord } from "../state";
import type { RunRecord } from "../types";

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
	return {
		schemaVersion: 1,
		recordId: "rec-1",
		launchToken: "tok-1",
		command: 'pi "do stuff"',
		execCommand: "pi",
		cwd: "/workspace",
		worktree: false,
		worktreePolicy: "keep",
		supervision: "interactive",
		completionContract: "exit-code",
		sessionId: "sess-1",
		ptyPid: 12345,
		status: "running",
		createdAt: "2025-01-01T00:00:00Z",
		startedAt: "2025-01-01T00:00:01Z",
		updatedAt: "2025-01-01T00:00:01Z",
		...overrides,
	};
}

describe("state (in-memory operations)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "dispatch-state-test-"));
		mockState.dir = tmpDir;
		mkdirSync(join(tmpDir, "pi-dispatch", "runs"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("createRunRecord", () => {
		it("persists a record and returns it", async () => {
			const record = makeRecord();
			const result = await createRunRecord(record);
			expect(result.recordId).toBe("rec-1");
			expect(getRunRecord("rec-1", "tok-1")).toEqual(result);
		});
	});

	describe("mutateRunRecord", () => {
		it("transforms and returns the updated record", async () => {
			await createRunRecord(makeRecord());
			const updated = await mutateRunRecord("rec-1", "tok-1", (r) => ({
				...r,
				status: "completed",
				exitCode: 0,
			}));
			expect(updated?.status).toBe("completed");
			expect(updated?.exitCode).toBe(0);
		});

		it("returns undefined for unknown record", async () => {
			const result = await mutateRunRecord("nonexistent", "tok", (r) => r);
			expect(result).toBeUndefined();
		});

		it("returns current record when transform returns undefined", async () => {
			await createRunRecord(makeRecord());
			const result = await mutateRunRecord("rec-1", "tok-1", () => undefined);
			expect(result?.status).toBe("running");
		});
	});

	describe("getRunRecord", () => {
		it("finds by recordId + launchToken", async () => {
			await createRunRecord(makeRecord());
			expect(getRunRecord("rec-1", "tok-1")?.recordId).toBe("rec-1");
		});

		it("returns undefined for unknown key", () => {
			expect(getRunRecord("nope", "nope")).toBeUndefined();
		});
	});

	describe("findBySessionId", () => {
		it("finds record by sessionId", async () => {
			await createRunRecord(makeRecord({ sessionId: "my-session" }));
			expect(findBySessionId("my-session")?.recordId).toBe("rec-1");
		});

		it("returns undefined for unknown sessionId", () => {
			expect(findBySessionId("nope")).toBeUndefined();
		});
	});

	describe("getIndex", () => {
		it("returns all records", async () => {
			await createRunRecord(makeRecord({ recordId: "r1", launchToken: "t1" }));
			await createRunRecord(makeRecord({ recordId: "r2", launchToken: "t2" }));
			// In-memory index accumulates across tests; verify our two are present
			expect(getIndex().length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("deleteRunRecord", () => {
		it("removes from index and returns undefined on subsequent get", async () => {
			const r = makeRecord({ recordId: "del-1", launchToken: "tok-del" });
			await createRunRecord(r);
			expect(getRunRecord("del-1", "tok-del")).toBeDefined();
			await deleteRunRecord("del-1", "tok-del");
			expect(getRunRecord("del-1", "tok-del")).toBeUndefined();
		});

		it("is safe to call on non-existent record", async () => {
			await expect(deleteRunRecord("nope", "nope")).resolves.toBeUndefined();
		});
	});
});
