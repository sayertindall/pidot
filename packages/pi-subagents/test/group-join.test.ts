import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupJoinManager } from "../extensions/subagents/group-join.ts";
import type { AgentRecord } from "../extensions/subagents/types.ts";

function fakeRecord(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id,
		type: "general-purpose",
		description: "test",
		status: "completed",
		toolUses: 0,
		startedAt: Date.now(),
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		compactionCount: 0,
		...overrides,
	};
}

describe("GroupJoinManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 'pass' for an agent that was never registered into a group", () => {
		const deliver = vi.fn();
		const mgr = new GroupJoinManager(deliver);
		expect(mgr.onAgentComplete(fakeRecord("solo"))).toBe("pass");
		expect(deliver).not.toHaveBeenCalled();
	});

	it("delivers immediately (non-partial) once every group member has completed", () => {
		const deliver = vi.fn();
		const mgr = new GroupJoinManager(deliver);
		mgr.registerGroup("g1", ["a", "b"]);

		expect(mgr.onAgentComplete(fakeRecord("a"))).toBe("held");
		expect(deliver).not.toHaveBeenCalled();

		expect(mgr.onAgentComplete(fakeRecord("b"))).toBe("delivered");
		expect(deliver).toHaveBeenCalledTimes(1);
		const [records, partial] = deliver.mock.calls[0] as [AgentRecord[], boolean];
		expect(records.map((r) => r.id).sort()).toEqual(["a", "b"]);
		expect(partial).toBe(false);
	});

	it("delivers a partial batch on timeout and re-groups stragglers under the shorter window", () => {
		const deliver = vi.fn();
		const mgr = new GroupJoinManager(deliver, 30_000);
		mgr.registerGroup("g1", ["a", "b", "c"]);

		mgr.onAgentComplete(fakeRecord("a"));
		vi.advanceTimersByTime(30_000);

		expect(deliver).toHaveBeenCalledTimes(1);
		const [firstRecords, firstPartial] = deliver.mock.calls[0] as [AgentRecord[], boolean];
		expect(firstRecords.map((r) => r.id)).toEqual(["a"]);
		expect(firstPartial).toBe(true);

		// Straggler "b" completes next -- should still be tracked (re-grouped, not dropped),
		// and use the shorter 15s straggler window rather than the original 30s.
		expect(mgr.isGrouped("b")).toBe(true);
		mgr.onAgentComplete(fakeRecord("b"));
		vi.advanceTimersByTime(15_000);

		expect(deliver).toHaveBeenCalledTimes(2);
		const [secondRecords, secondPartial] = deliver.mock.calls[1] as [AgentRecord[], boolean];
		expect(secondRecords.map((r) => r.id)).toEqual(["b"]);
		expect(secondPartial).toBe(true);
	});

	it("a group of one delivers immediately, non-partial", () => {
		const deliver = vi.fn();
		const mgr = new GroupJoinManager(deliver);
		mgr.registerGroup("solo-group", ["only"]);
		expect(mgr.onAgentComplete(fakeRecord("only"))).toBe("delivered");
		const [, partial] = deliver.mock.calls[0] as [AgentRecord[], boolean];
		expect(partial).toBe(false);
	});

	it("dispose() clears pending timeouts without delivering", () => {
		const deliver = vi.fn();
		const mgr = new GroupJoinManager(deliver);
		mgr.registerGroup("g1", ["a", "b"]);
		mgr.onAgentComplete(fakeRecord("a"));
		mgr.dispose();
		vi.advanceTimersByTime(60_000);
		expect(deliver).not.toHaveBeenCalled();
	});
});
