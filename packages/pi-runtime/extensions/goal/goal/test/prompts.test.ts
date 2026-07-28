import { describe, expect, it } from "vitest";
import type { GoalRuntimeState } from '../types';
import {
	buildInitialPrompt,
	buildContinuationPrompt,
	buildBudgetPrompt,
	buildManualHandoffPrompt,
	buildSummary,
} from '../prompts';
import { setController, clearController } from '../state';

function fakeState(overrides: Partial<GoalRuntimeState> = {}): GoalRuntimeState {
	return {
		goalId: "goal_test",
		objective: "ship the auth refactor",
		status: "active",
		thresholdPercent: 95,
		sessionIndex: 1,
		sessions: [],
		lastContextPercent: 42,
		lastContextTokens: 5000,
		contextWindow: 200000,
		continuationInFlight: false,
		handoffInFlight: false,
		...overrides,
	};
}

describe("buildInitialPrompt", () => {
	it("contains the objective", () => {
		const prompt = buildInitialPrompt("ship the auth refactor");
		expect(prompt).toContain("ship the auth refactor");
		expect(prompt).toContain("Active goal started");
		expect(prompt).toContain("update_goal");
	});
});

describe("buildContinuationPrompt", () => {
	it("contains the objective and context", () => {
		const state = fakeState();
		const prompt = buildContinuationPrompt(state);
		expect(prompt).toContain("ship the auth refactor");
		expect(prompt).toContain("Continue the active goal");
		expect(prompt).toContain("Context usage:");
	});
});

describe("buildBudgetPrompt", () => {
	it("describes budget limit and requests handoff", () => {
		const state = fakeState({ status: "budget_limited", lastContextPercent: 96 });
		const prompt = buildBudgetPrompt(state);
		expect(prompt).toContain("context budget limit");
		expect(prompt).toContain("goal_handoff");
		expect(prompt).toContain("96%");
	});
});

describe("buildManualHandoffPrompt", () => {
	it("describes user-requested handoff", () => {
		const state = fakeState();
		const prompt = buildManualHandoffPrompt(state);
		expect(prompt).toContain("user requested a handoff");
		expect(prompt).toContain("ship the auth refactor");
	});
});

describe("buildSummary", () => {
	function fakeCtx(usage?: any): any {
		return {
			getContextUsage: () => usage ?? { percent: 87, tokens: 10000, contextWindow: 200000 },
		};
	}

	it("returns no-goal message when state is null", () => {
		const summary = buildSummary(fakeCtx(), null);
		expect(summary).toContain("No active goal");
	});

	it("returns no-goal message when status is cleared", () => {
		const state = fakeState({ status: "cleared" });
		const summary = buildSummary(fakeCtx(), state);
		expect(summary).toContain("No active goal");
	});

	it("shows goal details for active state", () => {
		setController(undefined);
		const state = fakeState({
			currentSession: "session-1",
			parentSession: "session-0",
			sessions: ["session-0", "session-1"],
		});
		// buildSummary updates state.lastContextPercent from ctx.getContextUsage() (87%)
		const summary = buildSummary(fakeCtx(), state);
		expect(summary).toContain("ship the auth refactor");
		expect(summary).toContain("active");
		expect(summary).toContain("87% / 95%");
		expect(summary).toContain("session-1");
		expect(summary).toContain("session-0 -> session-1");
	});

	it("warns when controller is not captured", () => {
		clearController();
		const state = fakeState();
		const summary = buildSummary(fakeCtx(), state);
		expect(summary).toContain("handoff controller is not captured");
	});
});
