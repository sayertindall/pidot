/**
 * gates.test.ts
 *
 * Tests for shouldBlockAgentStart, runGate, isTaskGated.
 */

import { describe, expect, it, vi } from "vitest";
import { isTaskGated, runGate, shouldBlockAgentStart } from '../gates';
import type { TillDoneState } from '../types';

function makeState(overrides: Partial<TillDoneState> = {}): TillDoneState {
	return {
		enabled: false,
		tasks: [],
		nextId: 1,
		...overrides,
	};
}

describe("shouldBlockAgentStart", () => {
	it("does not block when disabled", () => {
		expect(shouldBlockAgentStart(makeState({ enabled: false })).block).toBe(false);
	});

	it("blocks when enabled and no tasks defined", () => {
		const result = shouldBlockAgentStart(makeState({ enabled: true, tasks: [] }));
		expect(result.block).toBe(true);
		expect(result.reason).toContain("No tasks defined");
	});

	it("blocks when enabled and all tasks done", () => {
		const result = shouldBlockAgentStart(
			makeState({
				enabled: true,
				tasks: [
					{ id: 1, text: "a", status: "done" },
					{ id: 2, text: "b", status: "done" },
				],
			}),
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("All tasks are done");
	});

	it("blocks when enabled and no task inprogress", () => {
		const result = shouldBlockAgentStart(
			makeState({
				enabled: true,
				tasks: [
					{ id: 1, text: "a", status: "idle" },
					{ id: 2, text: "b", status: "idle" },
				],
			}),
		);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("No task is in progress");
	});

	it("does not block when enabled and a task is inprogress", () => {
		const result = shouldBlockAgentStart(
			makeState({
				enabled: true,
				tasks: [
					{ id: 1, text: "a", status: "done" },
					{ id: 2, text: "b", status: "inprogress" },
				],
			}),
		);
		expect(result.block).toBe(false);
	});
});

describe("runGate", () => {
	it("returns passed=true when exit code is 0", async () => {
		const fakePi = {
			exec: vi.fn().mockResolvedValue({
				code: 0,
				stdout: "all good",
				stderr: "",
				killed: false,
			}),
		} as any;

		const result = await runGate("echo ok", fakePi);
		expect(result.passed).toBe(true);
		expect(result.stdout).toBe("all good");
	});

	it("returns passed=false when exit code is non-zero", async () => {
		const fakePi = {
			exec: vi.fn().mockResolvedValue({
				code: 1,
				stdout: "",
				stderr: "failed",
				killed: false,
			}),
		} as any;

		const result = await runGate("exit 1", fakePi);
		expect(result.passed).toBe(false);
	});

	it("returns passed=false when exec throws", async () => {
		const fakePi = {
			exec: vi.fn().mockRejectedValue(new Error("timeout")),
		} as any;

		const result = await runGate("sleep 999", fakePi);
		expect(result.passed).toBe(false);
		expect(result.stderr).toContain("timeout");
	});
});

describe("isTaskGated", () => {
	it("returns true when gate is a non-empty string", () => {
		expect(isTaskGated({ id: 1, text: "x", status: "idle", gate: "npm test" })).toBe(true);
	});

	it("returns false when gate is undefined", () => {
		expect(isTaskGated({ id: 1, text: "x", status: "idle" })).toBe(false);
	});

	it("returns false when gate is empty string", () => {
		expect(isTaskGated({ id: 1, text: "x", status: "idle", gate: "" })).toBe(false);
	});
});
