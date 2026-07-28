import { describe, expect, it, beforeEach } from "vitest";
import { setRuntimeState, clearController } from '../state';
import { latestAssistantError, pauseAfterAgentError, maybeQueueNextStep } from '../tool';
import type { GoalRuntimeState } from '../types';

describe("latestAssistantError", () => {
	it("returns undefined when no assistant messages", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [],
			},
		};
		expect(latestAssistantError(ctx as any)).toBeUndefined();
	});

	it("returns undefined when last assistant message is not an error", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: { role: "assistant", stopReason: "end_turn" },
					},
				],
			},
		};
		expect(latestAssistantError(ctx as any)).toBeUndefined();
	});

	it("returns error message when last assistant message is an error", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							stopReason: "error",
							errorMessage: "context window exceeded",
						},
					},
				],
			},
		};
		expect(latestAssistantError(ctx as any)).toBe("context window exceeded");
	});

	it("returns fallback for error without message", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: { role: "assistant", stopReason: "error" },
					},
				],
			},
		};
		expect(latestAssistantError(ctx as any)).toBe("Unknown agent error.");
	});

	it("scans from the end to find the last assistant message", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: { role: "assistant", stopReason: "error", errorMessage: "first error" },
					},
					{
						type: "message",
						message: { role: "assistant", stopReason: "end_turn" },
					},
					{
						type: "message",
						message: { role: "user" },
					},
				],
			},
		};
		// Last assistant is end_turn, not an error
		expect(latestAssistantError(ctx as any)).toBeUndefined();
	});
});

describe("pauseAfterAgentError", () => {
	beforeEach(() => {
		setRuntimeState(null);
		clearController();
	});

	it("does nothing when no active state", () => {
		const fakePi = { appendEntry: () => {} };
		const ctx = {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => [] },
			getContextUsage: () => undefined,
			hasUI: false,
		};
		pauseAfterAgentError(fakePi as any, ctx as any, "some error");
		// Should not throw
	});

	it("pauses an active goal", () => {
		const state: GoalRuntimeState = {
			goalId: "g1",
			objective: "test",
			status: "active",
			thresholdPercent: 95,
			sessionIndex: 1,
			sessions: [],
			lastContextPercent: 50,
			lastContextTokens: null,
			contextWindow: null,
			continuationInFlight: false,
			handoffInFlight: false,
		};
		setRuntimeState(state);

		let appendCalled = false;
		const fakePi = { appendEntry: () => { appendCalled = true; } };
		const ctx = {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => [] },
			getContextUsage: () => undefined,
			hasUI: false,
		};
		pauseAfterAgentError(fakePi as any, ctx as any, "some error");
		expect(state.status).toBe("paused");
		expect(appendCalled).toBe(true);

		setRuntimeState(null);
	});
});

describe("maybeQueueNextStep", () => {
	beforeEach(() => {
		setRuntimeState(null);
	});

	it("does nothing when no active state", () => {
		const fakePi = { appendEntry: () => {}, sendMessage: () => {} };
		const ctx = {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => [] },
			getContextUsage: () => ({ percent: 50 }),
			hasUI: false,
			hasPendingMessages: () => false,
		};
		// Should not throw
		maybeQueueNextStep(fakePi as any, ctx as any);
	});

	it("does nothing when state is paused", () => {
		const state: GoalRuntimeState = {
			goalId: "g1",
			objective: "test",
			status: "paused",
			thresholdPercent: 95,
			sessionIndex: 1,
			sessions: [],
			lastContextPercent: 50,
			lastContextTokens: null,
			contextWindow: null,
			continuationInFlight: false,
			handoffInFlight: false,
		};
		setRuntimeState(state);

		const fakePi = { appendEntry: () => {}, sendMessage: () => {} };
		const ctx = {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => [] },
			getContextUsage: () => ({ percent: 50 }),
			hasUI: false,
			hasPendingMessages: () => false,
		};
		maybeQueueNextStep(fakePi as any, ctx as any);
		// Status should still be paused - no continuation queued
		expect(state.status).toBe("paused");

		setRuntimeState(null);
	});
});
