/**
 * index.test.ts
 *
 * Integration test for the tilldone extension factory.
 * Drives the full lifecycle: register, session_start, commands, tool usage.
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tilldoneExtension from '../index';
import { statePath } from '../state';

let FAKE_HOME = "";

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => FAKE_HOME,
	};
});

// Mock truncateToWidth to avoid pi-tui dependency at runtime in tests.
vi.mock("@earendil-works/pi-tui", async () => {
	return {
		truncateToWidth: (s: string, _w: number) => s,
	};
});

interface CapturedTool {
	name: string;
	execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: any, ctx?: any) => Promise<{ content: { type: "text"; text: string }[]; details: any }>;
}

interface CapturedCommand {
	name: string;
	handler: (args: string | undefined, ctx: any) => Promise<void>;
}

interface CapturedEventHandler {
	event: string;
	handler: (...args: any[]) => any;
}

let pi: any;
let capturedTool: CapturedTool | undefined;
let capturedCommand: CapturedCommand | undefined;
let capturedEvents: CapturedEventHandler[] = [];
let sessionId: string;
let fakeCtx: any;

beforeEach(() => {
	FAKE_HOME = mkdtempSync(join(tmpdir(), "tilldone-idx-test-"));
	sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	capturedTool = undefined;
	capturedCommand = undefined;
	capturedEvents = [];
	fakeCtx = {
		mode: "tui",
		hasUI: true,
		cwd: "/tmp/test",
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
		},
		sessionManager: { getSessionId: () => sessionId },
		modelRegistry: {},
		model: undefined,
		isIdle: () => true,
		isProjectTrusted: () => true,
		signal: undefined,
		abort: vi.fn(),
		hasPendingMessages: () => false,
		shutdown: vi.fn(),
		getContextUsage: () => undefined,
		compact: vi.fn(),
		getSystemPrompt: () => "",
	};

	pi = {
		registerTool: vi.fn((def: any) => {
			capturedTool = { name: def.name, execute: def.execute };
		}),
		registerCommand: vi.fn((name: string, def: any) => {
			capturedCommand = { name, handler: def.handler };
		}),
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			capturedEvents.push({ event, handler });
		}),
		sendMessage: vi.fn(),
		exec: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "", killed: false }),
	};

	tilldoneExtension(pi);
});

afterEach(() => {
	rmSync(FAKE_HOME, { recursive: true, force: true });
});

function findHandler(event: string): ((...args: any[]) => any) | undefined {
	return capturedEvents.find((e) => e.event === event)?.handler;
}

describe("tilldone extension factory", () => {
	it("registers the tilldone tool", () => {
		expect(capturedTool?.name).toBe("tilldone");
	});

	it("registers the /tasks command", () => {
		expect(capturedCommand?.name).toBe("tasks");
	});

	it("registers session_start handler", () => {
		expect(findHandler("session_start")).toBeDefined();
	});

	it("registers before_agent_start handler", () => {
		expect(findHandler("before_agent_start")).toBeDefined();
	});

	it("registers agent_end handler", () => {
		expect(findHandler("agent_end")).toBeDefined();
	});

	it("registers input handler", () => {
		expect(findHandler("input")).toBeDefined();
	});

	describe("session_start", () => {
		it("updates widget on session_start", async () => {
			const handler = findHandler("session_start")!;
			await handler({}, fakeCtx);
			// Widget should be cleared (disabled by default).
			expect(fakeCtx.ui.setStatus).toHaveBeenCalledWith("tilldone", undefined);
			expect(fakeCtx.ui.setWidget).toHaveBeenCalledWith("tilldone-current", undefined);
		});
	});

	describe("before_agent_start", () => {
		it("returns nothing when disabled", async () => {
			const handler = findHandler("before_agent_start")!;
			const result = await handler();
			expect(result).toBeUndefined();
		});

		it("blocks when enabled but no tasks", async () => {
			// Fire session_start to set sessionId in the factory.
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			// Enable via command first.
			await capturedCommand!.handler("on", fakeCtx);

			const handler = findHandler("before_agent_start")!;
			const result = await handler();
			expect(result).toBeDefined();
			expect(result.message.customType).toBe("tilldone-block");
			expect(result.message.content).toContain("No tasks defined");
		});

		it("injects context when tasks exist and a task is inprogress", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("call-1", { action: "add", text: "Write tests" }, undefined, undefined, fakeCtx);
			await capturedTool!.execute("call-2", { action: "update", id: 1, status: "inprogress" }, undefined, undefined, fakeCtx);

			const handler = findHandler("before_agent_start")!;
			const result = await handler();
			expect(result).toBeDefined();
			expect(result.message.customType).toBe("tilldone-context");
			expect(result.message.content).toContain("#1");
			expect(result.message.content).toContain("Write tests");
		});

		it("does not write to disk (pure read)", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);
			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("c1", { action: "add", text: "A" }, undefined, undefined, fakeCtx);
			await capturedTool!.execute("c2", { action: "update", id: 1, status: "inprogress" }, undefined, undefined, fakeCtx);

			const path = statePath(sessionId);
			const before = statSync(path).mtimeMs;
			await new Promise((resolve) => setTimeout(resolve, 15));

			await findHandler("before_agent_start")!();
			expect(statSync(path).mtimeMs).toBe(before);
		});
	});

	describe("agent_end nudge", () => {
		it("does not nudge when disabled", async () => {
			const handler = findHandler("agent_end")!;
			await handler({}, fakeCtx);
			expect(pi.sendMessage).not.toHaveBeenCalled();
		});

		it("nudges when enabled and tasks are incomplete", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("call-1", { action: "add", texts: ["A", "B"] }, undefined, undefined, fakeCtx);

			const handler = findHandler("agent_end")!;
			await handler({}, fakeCtx);
			expect(pi.sendMessage).toHaveBeenCalled();
			const call = pi.sendMessage.mock.calls[0]!;
			expect(call[0].customType).toBe("tilldone-nudge");
			expect(call[1]).toEqual({ triggerTurn: true });
		});

		it("does not nudge when all tasks are done", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("call-1", { action: "add", text: "A" }, undefined, undefined, fakeCtx);
			await capturedTool!.execute("call-2", { action: "done", id: 1 }, undefined, undefined, fakeCtx);

			const handler = findHandler("agent_end")!;
			await handler({}, fakeCtx);
			expect(pi.sendMessage).not.toHaveBeenCalled();
		});

		it("does not write to disk (pure read)", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);
			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("c1", { action: "add", texts: ["A"] }, undefined, undefined, fakeCtx);

			const path = statePath(sessionId);
			const before = statSync(path).mtimeMs;
			await new Promise((resolve) => setTimeout(resolve, 15));

			await findHandler("agent_end")!({}, fakeCtx);
			expect(statSync(path).mtimeMs).toBe(before);
		});

		it("only nudges once per cycle", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			await capturedCommand!.handler("on", fakeCtx);
			await capturedTool!.execute("call-1", { action: "add", text: "A" }, undefined, undefined, fakeCtx);

			const handler = findHandler("agent_end")!;
			await handler({}, fakeCtx);
			expect(pi.sendMessage).toHaveBeenCalledTimes(1);

			// Second call should not nudge again.
			await handler({}, fakeCtx);
			expect(pi.sendMessage).toHaveBeenCalledTimes(1);

			// After input, nudge should re-arm.
			const inputHandler = findHandler("input")!;
			await inputHandler();
			await handler({}, fakeCtx);
			expect(pi.sendMessage).toHaveBeenCalledTimes(2);
		});
	});

	describe("full lifecycle", () => {
		it("enables, adds tasks, completes them, disables", async () => {
			const sessionStart = findHandler("session_start")!;
			await sessionStart({}, fakeCtx);

			// Enable
			await capturedCommand!.handler("on", fakeCtx);
			expect(fakeCtx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Task mode enabled"),
				"info",
			);

			// Add tasks
			const addResult = await capturedTool!.execute(
				"call-1",
				{ action: "add", texts: ["Task A", "Task B", "Task C"] },
				undefined,
				undefined,
				fakeCtx,
			);
			expect(addResult.details.tasks).toHaveLength(3);

			// Set first to inprogress
			await capturedTool!.execute(
				"call-2",
				{ action: "update", id: 1, status: "inprogress" },
				undefined,
				undefined,
				fakeCtx,
			);

			// Mark done
			await capturedTool!.execute(
				"call-3",
				{ action: "done", id: 1 },
				undefined,
				undefined,
				fakeCtx,
			);
			await capturedTool!.execute(
				"call-4",
				{ action: "next" },
				undefined,
				undefined,
				fakeCtx,
			);
			await capturedTool!.execute(
				"call-5",
				{ action: "done", id: 2 },
				undefined,
				undefined,
				fakeCtx,
			);
			await capturedTool!.execute(
				"call-6",
				{ action: "next" },
				undefined,
				undefined,
				fakeCtx,
			);
			await capturedTool!.execute(
				"call-7",
				{ action: "done", id: 3 },
				undefined,
				undefined,
				fakeCtx,
			);

			// Check status
			vi.clearAllMocks();
			await capturedCommand!.handler("status", fakeCtx);
			expect(fakeCtx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("3 done"),
				"info",
			);
		});
	});
});
