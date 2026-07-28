/**
 * subagent-dispatch.test.ts — Subagent-task dispatch in message-handler
 *
 * Tests that handleCommand routes send commands with metadata.kind === "subagent-task"
 * to the subagent-runner instead of the normal send handler.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock the subagent-runner module
const mockRunSubagentTask = vi.fn();
vi.mock("../extensions/session-control/subagent-runner", () => ({
	runSubagentTask: mockRunSubagentTask,
}));

// We need to mock enough of the pi/ExtensionAPI surface to call handleCommand.
// The handleCommand function re-imports subagent-runner dynamically, so the
// mock above should be picked up.

// Mock protocol to capture responses
const mockWriteResponse = vi.fn();
vi.mock("../extensions/session-control/protocol", () => ({
	writeResponse: mockWriteResponse,
	writeEvent: vi.fn(),
	parseCommand: (line: string) => {
		try { return { command: JSON.parse(line) }; }
		catch (e) { return { error: String(e) }; }
	},
}));

// Mock summarizer (avoid model calls)
vi.mock("../extensions/session-control/summarizer", () => ({
	getLastAssistantMessage: vi.fn(() => undefined),
	getMessagesSinceLastPrompt: vi.fn(() => []),
	formatSummary: vi.fn(),
}));

// Mock hooks
vi.mock("../extensions/session-control/hooks", () => ({
	syncAlias: vi.fn(),
	isSafeAlias: vi.fn(() => true),
	getSessionAlias: vi.fn(() => null),
	updateStatus: vi.fn(),
	updateSessionEnv: vi.fn(),
}));

import { handleCommand } from "../extensions/session-control/message-handler";
import type { SocketState } from "../extensions/session-control/types";

function mockSocket(): any {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		write: vi.fn(),
		end: vi.fn(),
		destroy: vi.fn(),
		setEncoding: vi.fn(),
		once: vi.fn(),
		removeAllListeners: vi.fn(),
	});
}

function mockPi(): any {
	return {
		sendMessage: vi.fn(),
		on: vi.fn(),
	};
}

function mockCtx(): any {
	return {
		isIdle: () => true,
		abort: vi.fn(),
		sessionManager: {
			getSessionId: () => "test-session-id",
			getSessionName: () => "test-session",
			getBranch: () => [],
			getEntries: () => [],
			getLeafId: () => null,
		},
		hasUI: false,
		cwd: "/tmp",
		model: undefined,
		modelRegistry: {
			find: vi.fn(),
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
		signal: undefined,
		shutdown: vi.fn(),
	};
}

function mockState(): SocketState {
	return {
		server: null,
		socketPath: null,
		context: mockCtx(),
		alias: null,
		aliasTimer: null,
		gcTimer: null,
		turnEndSubscriptions: [],
		resultReadySubscriptions: [],
		rateLimits: new Map(),
		tags: {},
	};
}

describe("handleCommand — subagent-task dispatch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes send with subagent-task metadata to runSubagentTask", async () => {
		const pi = mockPi();
		const state = mockState();
		const socket = mockSocket();

		const command = {
			type: "send" as const,
			message: "locate auth code",
			metadata: {
				kind: "subagent-task",
				runId: "run-test",
				parentSessionId: "parent-1",
				parentKey: "pk_test",
				agentName: "finder",
				task: "locate auth code",
				agentConfig: { name: "finder", model: "test/model" },
				lifecycle: "single" as const,
			},
		};

		await handleCommand(pi, state, command, socket);

		expect(mockRunSubagentTask).toHaveBeenCalledTimes(1);
		expect(mockRunSubagentTask).toHaveBeenCalledWith(
			pi,
			state.context,
			command.metadata,
			state,
		);

		expect(mockWriteResponse).toHaveBeenCalledWith(
			socket,
			expect.objectContaining({
				type: "response",
				command: "send",
				success: true,
			}),
		);
	});

	it("does NOT route normal send to runSubagentTask", async () => {
		const pi = mockPi();
		const state = mockState();
		const socket = mockSocket();

		const command = {
			type: "send" as const,
			message: "hello",
			mode: "steer" as const,
		};

		await handleCommand(pi, state, command, socket);

		expect(mockRunSubagentTask).not.toHaveBeenCalled();
	});

	it("routes send with metadata but without kind=subagent-task normally", async () => {
		const pi = mockPi();
		const state = mockState();
		const socket = mockSocket();

		const command = {
			type: "send" as const,
			message: "hello",
			metadata: {
				kind: "user-message",  // NOT subagent-task
				senderId: "test",
			},
		};

		await handleCommand(pi, state, command, socket);

		expect(mockRunSubagentTask).not.toHaveBeenCalled();
	});
});
