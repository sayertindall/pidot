import { describe, expect, it, beforeEach } from "vitest";
import { registerCommand } from '../command';
import { setRuntimeState, getRuntimeState, clearController } from '../state';
import type { GoalStateEntry } from '../types';

describe("registerCommand", () => {
	let capturedCommand: any;
	let visibleMessages: string[];

	function makeStateEntry(overrides: Partial<GoalStateEntry> = {}): any {
		return {
			type: "custom",
			customType: "pi-goal:state",
			data: {
				version: 1,
				event: "created",
				goalId: "g1",
				objective: "test objective",
				status: "active",
				thresholdPercent: 95,
				sessionIndex: 1,
				timestamp: Date.now(),
				...overrides,
			},
		};
	}

	beforeEach(() => {
		setRuntimeState(null);
		clearController();
		visibleMessages = [];
		capturedCommand = null;

		const fakePi = {
			registerCommand: (name: string, cmd: any) => {
				capturedCommand = { name, cmd };
			},
			sendMessage: (msg: any) => {
				if (msg.display) visibleMessages.push(msg.content);
			},
			setSessionName: () => {},
			appendEntry: () => {},
		};

		registerCommand(fakePi as any);
	});

	it("registers the goal command", () => {
		expect(capturedCommand).not.toBeNull();
		expect(capturedCommand.name).toBe("goal");
	});

	it("no args shows summary", async () => {
		const ctx = {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => [] },
			getContextUsage: () => ({ percent: 50 }),
			hasUI: false,
		};
		await capturedCommand.cmd.handler("", ctx);
		expect(visibleMessages.length).toBe(1);
		expect(visibleMessages[0]).toContain("No active goal");
	});

	function fakeCtx(entries: any[] = [], usage?: any): any {
		return {
			sessionManager: { getSessionFile: () => "sess-1", getBranch: () => entries },
			getContextUsage: () => usage ?? { percent: 50, tokens: 10000, contextWindow: 200000 },
			hasUI: true,
			ui: {
				setStatus: () => {},
				setWidget: () => {},
				notify: () => {},
				confirm: async () => true,
			},
		};
	}

	it("pause subcommand pauses active goal", async () => {
		const ctx = fakeCtx([makeStateEntry()]);
		await capturedCommand.cmd.handler("pause", ctx);
		const s = getRuntimeState();
		expect(s).not.toBeNull();
		expect(s!.status).toBe("paused");

		setRuntimeState(null);
	});

	it("resume subcommand resumes paused goal", async () => {
		const ctx = fakeCtx([makeStateEntry({ status: "paused" })]);
		await capturedCommand.cmd.handler("resume", ctx);
		const s = getRuntimeState();
		expect(s!.status).toBe("active");

		setRuntimeState(null);
	});

	it("clear subcommand clears active goal", async () => {
		const ctx = fakeCtx([makeStateEntry()]);
		await capturedCommand.cmd.handler("clear", ctx);
		const s = getRuntimeState();
		expect(s!.status).toBe("cleared");

		setRuntimeState(null);
	});

	it("handoff subcommand requests handoff", async () => {
		const ctx = fakeCtx([makeStateEntry()]);
		await capturedCommand.cmd.handler("handoff", ctx);
		const s = getRuntimeState();
		expect(s!.status).toBe("handoff_started");

		setRuntimeState(null);
	});

	it("objective string starts a new goal", async () => {
		const ctx = fakeCtx([]);
		await capturedCommand.cmd.handler("ship the auth refactor", ctx);
		const state = getRuntimeState();
		expect(state).not.toBeNull();
		expect(state!.objective).toBe("ship the auth refactor");
		expect(state!.status).toBe("active");

		setRuntimeState(null);
	});

	it("prompts to replace when non-terminal goal exists", async () => {
		let confirmCalled = false;
		const ctx = {
			...fakeCtx([makeStateEntry()]),
			ui: {
				setStatus: () => {},
				setWidget: () => {},
				notify: () => {},
				confirm: async (_title: string, _msg: string) => {
					confirmCalled = true;
					return true;
				},
			},
		};

		await capturedCommand.cmd.handler("new goal", ctx);
		expect(confirmCalled).toBe(true);

		setRuntimeState(null);
	});
});
