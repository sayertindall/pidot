import { describe, expect, it, beforeEach } from "vitest";
import type { GoalRuntimeState } from '../types';
import { updateTui } from '../widget';

describe("updateTui", () => {
	let statusCalls: any[];
	let widgetCalls: any[];
	let fakeCtx: any;

	function fakeState(overrides: Partial<GoalRuntimeState> = {}): GoalRuntimeState {
		return {
			goalId: "g1",
			objective: "test objective",
			status: "active",
			thresholdPercent: 95,
			sessionIndex: 1,
			sessions: [],
			lastContextPercent: 42,
			lastContextTokens: null,
			contextWindow: null,
			continuationInFlight: false,
			handoffInFlight: false,
			...overrides,
		};
	}

	beforeEach(() => {
		statusCalls = [];
		widgetCalls = [];
		fakeCtx = {
			hasUI: true,
			ui: {
				setStatus: (key: string, value: any) => statusCalls.push({ key, value }),
				setWidget: (key: string, value: any) => widgetCalls.push({ key, value }),
			},
		};
	});

	it("clears status and widget when state is null", () => {
		updateTui(fakeCtx, null);
		expect(statusCalls).toEqual([{ key: "goal", value: undefined }]);
		expect(widgetCalls).toEqual([{ key: "goal", value: undefined }]);
	});

	it("clears status and widget when state is cleared", () => {
		updateTui(fakeCtx, fakeState({ status: "cleared" }));
		expect(statusCalls).toEqual([{ key: "goal", value: undefined }]);
	});

	it("shows active status with context percent", () => {
		updateTui(fakeCtx, fakeState());
		expect(statusCalls[0].value).toContain("active");
		expect(statusCalls[0].value).toContain("42%");
	});

	it("shows paused status", () => {
		updateTui(fakeCtx, fakeState({ status: "paused" }));
		expect(statusCalls[0].value).toContain("paused");
	});

	it("shows complete and clears widget", () => {
		updateTui(fakeCtx, fakeState({ status: "complete" }));
		expect(statusCalls[0].value).toContain("complete");
		expect(widgetCalls).toEqual([{ key: "goal", value: undefined }]);
	});

	it("shows budget_limited in widget", () => {
		updateTui(fakeCtx, fakeState({ status: "budget_limited", lastContextPercent: 96, handoffInFlight: true }));
		expect(statusCalls[0].value).toContain("budget");
		expect(widgetCalls[0].value[2]).toContain("waiting for goal_handoff");
	});

	it("no-ops when hasUI is false", () => {
		fakeCtx.hasUI = false;
		updateTui(fakeCtx, fakeState());
		expect(statusCalls).toHaveLength(0);
	});
});
