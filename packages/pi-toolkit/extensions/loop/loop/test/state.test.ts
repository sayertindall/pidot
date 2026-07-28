/**
 * state.test.ts
 *
 * Tests for loadState and persistState using appendEntry.
 */

import { describe, expect, it, vi } from "vitest";
import { loadState, persistState } from '../state';
import type { LoopStateData } from '../types';

interface FakeEntry {
	type: string;
	customType?: string;
	data?: LoopStateData;
}

function fakeCtx(entries: FakeEntry[]) {
	return {
		sessionManager: {
			getEntries: () => entries,
		},
	} as any;
}

describe("loadState", () => {
	it("returns { active: false } when no entries exist", async () => {
		const ctx = fakeCtx([]);
		const state = await loadState(ctx);
		expect(state).toEqual({ active: false });
	});

	it("returns { active: false } when entries exist but none are loop-state", async () => {
		const ctx = fakeCtx([
			{ type: "message" },
			{ type: "custom", customType: "other-thing", data: { active: true } },
		]);
		const state = await loadState(ctx);
		expect(state).toEqual({ active: false });
	});

	it("returns the data from a single loop-state entry", async () => {
		const expected: LoopStateData = { active: true, mode: "tests", prompt: "Run tests" };
		const ctx = fakeCtx([
			{ type: "custom", customType: "loop-state", data: expected },
		]);
		const state = await loadState(ctx);
		expect(state).toEqual(expected);
	});

	it("returns the most recent loop-state entry when multiple exist", async () => {
		const older: LoopStateData = { active: true, mode: "tests", loopCount: 3 };
		const newer: LoopStateData = { active: true, mode: "self", loopCount: 1 };
		const ctx = fakeCtx([
			{ type: "custom", customType: "loop-state", data: older },
			{ type: "message" },
			{ type: "custom", customType: "loop-state", data: newer },
		]);
		const state = await loadState(ctx);
		expect(state).toEqual(newer);
	});

	it("skips loop-state entries that have no data", async () => {
		const expected: LoopStateData = { active: true, mode: "tests" };
		const ctx = fakeCtx([
			{ type: "custom", customType: "loop-state", data: undefined },
			{ type: "custom", customType: "loop-state", data: expected },
		]);
		const state = await loadState(ctx);
		expect(state).toEqual(expected);
	});
});

describe("persistState", () => {
	it("calls pi.appendEntry with LOOP_STATE_ENTRY and the state", () => {
		const appendEntry = vi.fn();
		const pi = { appendEntry } as any;
		const state: LoopStateData = { active: true, mode: "tests" };

		persistState(pi, state);

		expect(appendEntry).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith("loop-state", state);
	});
});
