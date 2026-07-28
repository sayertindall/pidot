import { describe, expect, it, beforeEach } from "vitest";
import { setRuntimeState, getRuntimeState, clearController, getController, setController } from '../state';
import type { GoalRuntimeState } from '../types';

// Import the extension factory
import extensionFactory from '../index';

describe("index (extension factory)", () => {
	let events: Record<string, any>;
	let registeredCommands: string[];
	let registeredTools: string[];
	let pi: any;

	beforeEach(() => {
		setRuntimeState(null);
		clearController();
		events = {};
		registeredCommands = [];
		registeredTools = [];

		pi = {
			on: (event: string, handler: any) => {
				events[event] = handler;
			},
			registerCommand: (name: string, _cmd: any) => {
				registeredCommands.push(name);
			},
			registerTool: (tool: any) => {
				registeredTools.push(tool.name);
			},
		};

		extensionFactory(pi);
	});

	it("registers session_start handler", () => {
		expect(events.session_start).toBeDefined();
	});

	it("registers session_tree handler", () => {
		expect(events.session_tree).toBeDefined();
	});

	it("registers session_shutdown handler", () => {
		expect(events.session_shutdown).toBeDefined();
	});

	it("registers agent_start handler", () => {
		expect(events.agent_start).toBeDefined();
	});

	it("registers agent_settled handler", () => {
		expect(events.agent_settled).toBeDefined();
	});

	it("registers goal command", () => {
		expect(registeredCommands).toContain("goal");
	});

	it("registers all four tools", () => {
		expect(registeredTools).toContain("get_goal");
		expect(registeredTools).toContain("create_goal");
		expect(registeredTools).toContain("update_goal");
		expect(registeredTools).toContain("goal_handoff");
	});

	it("session_shutdown clears controller", () => {
		// Set up a fake controller
		setController({} as any);
		expect(getController()).toBeDefined();

		// Fire shutdown
		events.session_shutdown();

		expect(getController()).toBeUndefined();
	});

	it("agent_start clears continuation flag", () => {
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
			continuationInFlight: true,
			handoffInFlight: false,
		};
		setRuntimeState(state);

		events.agent_start();

		expect(state.continuationInFlight).toBe(false);

		setRuntimeState(null);
	});

	it("agent_start no-ops when no runtime state", () => {
		// Should not throw
		events.agent_start();
	});

	it("session_start reconstructs state from branch", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
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
						},
					},
				],
			},
			getContextUsage: () => undefined,
			hasUI: false,
		};

		events.session_start({}, ctx);
		const state = getRuntimeState();
		expect(state).not.toBeNull();
		expect(state!.objective).toBe("test objective");

		setRuntimeState(null);
	});
});
