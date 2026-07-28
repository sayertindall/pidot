import { describe, expect, it } from "vitest";
import { buildKickoffPrompt, appendGoalStateToSessionManager } from '../handoff';
import type { GoalStateEntry } from '../types';

describe("buildKickoffPrompt", () => {
	it("includes objective, handoff, and parent session", () => {
		const prompt = buildKickoffPrompt(
			"ship the auth refactor",
			"Completed: login flow. Next: refactor middleware.",
			"session-parent-123",
		);
		expect(prompt).toContain("ship the auth refactor");
		expect(prompt).toContain("Completed: login flow. Next: refactor middleware.");
		expect(prompt).toContain("session-parent-123");
		expect(prompt).toContain("session_query");
	});

	it("omits parent session info when none provided", () => {
		const prompt = buildKickoffPrompt(
			"ship the auth refactor",
			"Completed: everything.",
			undefined,
		);
		expect(prompt).not.toContain("Parent session:");
		expect(prompt).not.toContain("session_query");
	});
});

describe("appendGoalStateToSessionManager", () => {
	it("calls appendCustomEntry and appendSessionInfo when available", () => {
		const calls: string[] = [];
		const sm = {
			appendCustomEntry: (type: string, _entry: any) => calls.push(`custom:${type}`),
			appendSessionInfo: (name: string) => calls.push(`info:${name}`),
		};

		const entry: GoalStateEntry = {
			version: 1,
			event: "handoff_completed",
			goalId: "goal_test",
			objective: "test",
			status: "active",
			thresholdPercent: 95,
			sessionIndex: 2,
			parentSession: "parent",
			currentSession: "child",
			contextPercent: null,
			contextTokens: null,
			contextWindow: null,
			timestamp: Date.now(),
		};

		appendGoalStateToSessionManager(sm, entry, "goal: test");
		expect(calls).toContain("custom:pi-goal:state");
		expect(calls).toContain("info:goal: test");
	});

	it("handles missing methods gracefully", () => {
		const sm = {};
		const entry: GoalStateEntry = {
			version: 1,
			event: "handoff_completed",
			goalId: "goal_test",
			timestamp: Date.now(),
		};
		expect(() => appendGoalStateToSessionManager(sm, entry, "name")).not.toThrow();
	});
});
