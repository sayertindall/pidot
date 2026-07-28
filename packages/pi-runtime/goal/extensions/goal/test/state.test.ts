import { describe, expect, it } from "vitest";
import {
	newGoalId,
	shortObjective,
	pushUnique,
	isNonTerminal,
	updateUsage,
	goalSessionName,
	appendState,
	reconstructState,
	setRuntimeState,
	getRuntimeState,
} from '../state';
import type { GoalRuntimeState, GoalStateEntry } from '../types';

describe("newGoalId", () => {
	it("generates unique IDs with goal_ prefix", () => {
		const id1 = newGoalId();
		const id2 = newGoalId();
		expect(id1).toMatch(/^goal_/);
		expect(id2).toMatch(/^goal_/);
		expect(id1).not.toBe(id2);
	});
});

describe("shortObjective", () => {
	it("returns the full objective when within limit", () => {
		expect(shortObjective("hello", 10)).toBe("hello");
	});

	it("truncates with ellipsis when over limit", () => {
		expect(shortObjective("hello world this is long", 10)).toBe("hello wor…");
	});

	it("collapses whitespace", () => {
		expect(shortObjective("hello   world", 20)).toBe("hello world");
	});
});

describe("pushUnique", () => {
	it("adds a new value", () => {
		const arr: string[] = [];
		pushUnique(arr, "a");
		expect(arr).toEqual(["a"]);
	});

	it("does not add duplicates", () => {
		const arr = ["a", "b"];
		pushUnique(arr, "a");
		expect(arr).toEqual(["a", "b"]);
	});

	it("ignores undefined", () => {
		const arr: string[] = [];
		pushUnique(arr, undefined);
		expect(arr).toEqual([]);
	});
});

describe("isNonTerminal", () => {
	it("returns true for active", () => {
		expect(isNonTerminal({ status: "active" } as GoalRuntimeState)).toBe(true);
	});

	it("returns false for complete", () => {
		expect(isNonTerminal({ status: "complete" } as GoalRuntimeState)).toBe(false);
	});

	it("returns false for cleared", () => {
		expect(isNonTerminal({ status: "cleared" } as GoalRuntimeState)).toBe(false);
	});

	it("returns false for null", () => {
		expect(isNonTerminal(null)).toBe(false);
	});
});

describe("updateUsage", () => {
	it("updates context fields from usage object", () => {
		const state = {
			lastContextPercent: null,
			lastContextTokens: null,
			contextWindow: null,
		} as GoalRuntimeState;

		updateUsage(state, { percent: 87, tokens: 50000, contextWindow: 200000 });
		expect(state.lastContextPercent).toBe(87);
		expect(state.lastContextTokens).toBe(50000);
		expect(state.contextWindow).toBe(200000);
	});

	it("no-ops on undefined usage", () => {
		const state = {
			lastContextPercent: 10,
			lastContextTokens: 100,
			contextWindow: 1000,
		} as GoalRuntimeState;
		updateUsage(state, undefined);
		expect(state.lastContextPercent).toBe(10);
	});
});

describe("goalSessionName", () => {
	it("returns base name for session 1", () => {
		expect(goalSessionName("ship auth refactor", 1)).toBe("goal: ship auth refactor");
	});

	it("appends session number for session > 1", () => {
		expect(goalSessionName("ship auth refactor", 3)).toBe("goal: ship auth refactor (3)");
	});
});

describe("reconstructState", () => {
	function fakeCtx(entries: any[]): any {
		return {
			sessionManager: {
				getBranch: () => entries,
			},
			getContextUsage: () => undefined,
		};
	}

	function makeEntry(overrides: Partial<GoalStateEntry> = {}): any {
		return {
			type: "custom",
			customType: "pi-goal:state",
			data: {
				version: 1,
				event: "created",
				goalId: "goal_test",
				objective: "test objective",
				status: "active",
				thresholdPercent: 95,
				sessionIndex: 1,
				timestamp: Date.now(),
				...overrides,
			},
		};
	}

	it("returns null with no entries", () => {
		const state = reconstructState(fakeCtx([]));
		expect(state).toBeNull();
	});

	it("reconstructs from a created entry", () => {
		const state = reconstructState(fakeCtx([makeEntry()]));
		expect(state).not.toBeNull();
		expect(state!.goalId).toBe("goal_test");
		expect(state!.objective).toBe("test objective");
		expect(state!.status).toBe("active");
	});

	it("applies status updates in order", () => {
		const state = reconstructState(
			fakeCtx([
				makeEntry(),
				makeEntry({ event: "status_changed", status: "paused" }),
			]),
		);
		expect(state!.status).toBe("paused");
	});

	it("handles a complete lifecycle", () => {
		const entries = [
			makeEntry(),
			makeEntry({ event: "status_changed", status: "paused" }),
			makeEntry({ event: "status_changed", status: "active" }),
			makeEntry({ event: "budget_limited", status: "budget_limited" }),
			makeEntry({ event: "handoff_requested", status: "handoff_started" }),
			makeEntry({ event: "completed", status: "complete" }),
		];
		const state = reconstructState(fakeCtx(entries));
		expect(state!.status).toBe("complete");
		expect(state!.sessions).toHaveLength(0);
	});

	it("ignores non-custom entries", () => {
		const state = reconstructState(
			fakeCtx([
				{ type: "message", role: "user" },
				makeEntry(),
			]),
		);
		expect(state).not.toBeNull();
	});

	it("updates runtimeState module variable", () => {
		setRuntimeState(null);
		reconstructState(fakeCtx([makeEntry()]));
		expect(getRuntimeState()).not.toBeNull();
		setRuntimeState(null);
	});
});

describe("appendState", () => {
	it("returns null when no goalId is available", () => {
		setRuntimeState(null);
		const fakePi = { appendEntry: () => {} };
		const result = appendState(fakePi as any, "created");
		expect(result).toBeNull();
	});

	it("writes entry and updates runtime state", () => {
		const captured: any[] = [];
		const fakePi = { appendEntry: (_type: string, entry: any) => captured.push(entry) };

		// Set up existing state
		setRuntimeState({
			goalId: "goal_test",
			objective: "test",
			status: "active",
			thresholdPercent: 95,
			sessionIndex: 1,
			sessions: [],
			lastContextPercent: null,
			lastContextTokens: null,
			contextWindow: null,
			continuationInFlight: false,
			handoffInFlight: false,
		});

		const entry = appendState(fakePi as any, "completed", {
			status: "complete",
			contextPercent: 100,
		});
		expect(entry).not.toBeNull();
		expect(entry!.event).toBe("completed");
		expect(entry!.status).toBe("complete");
		expect(captured).toHaveLength(1);

		const state = getRuntimeState();
		expect(state!.status).toBe("complete");
		expect(state!.lastContextPercent).toBe(100);

		setRuntimeState(null);
	});
});
