/**
 * index.test.ts
 *
 * Integration test for the loop extension factory. Drives the /loop
 * command and signal_loop_success tool with a fake pi and fake ctx.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock TUI components used by the selector.
vi.mock("@earendil-works/pi-tui", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-tui");
	return {
		...actual,
		Container: class FakeContainer {
			children: any[] = [];
			addChild(c: any) { this.children.push(c); }
			render(_width: number) { return ["mock container"]; }
			invalidate() {}
		},
		SelectList: class FakeSelectList {
			onSelect: ((item: any) => void) | null = null;
			onCancel: (() => void) | null = null;
			constructor(_items: any[], _maxHeight: number, _opts: any) {}
			handleInput(_data: string) {}
		},
		Text: class FakeText {
			constructor(_text: string) {}
		},
	};
});

// Mock DynamicBorder from pi-coding-agent.
vi.mock("@earendil-works/pi-coding-agent", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-coding-agent");
	return {
		...actual,
		DynamicBorder: class FakeDynamicBorder {
			constructor(_fn: (s: string) => string) {}
		},
		compact: vi.fn(async () => "compacted summary"),
	};
});

// Mock complete from pi-ai/compat so summarizer doesn't need real network.
vi.mock("@earendil-works/pi-ai/compat", () => {
	let result: any = {
		stopReason: "stop",
		content: [{ type: "text", text: "loops until tests pass" }],
	};
	return {
		complete: vi.fn(async () => result),
		__setCompleteResult: (r: any) => {
			result = r;
		},
	};
});

import type { LoopStateData } from '../types';

interface CapturedCommand {
	name: string;
	description: string;
	handler: (args: string | undefined, ctx: any) => Promise<void>;
}

interface CapturedTool {
	name: string;
	execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
}

interface CapturedEvent {
	event: string;
	handler: (event: any, ctx: any) => Promise<any>;
}

let commands: CapturedCommand[] = [];
let tools: CapturedTool[] = [];
let events: CapturedEvent[] = [];
let appendedEntries: Array<[string, LoopStateData]> = [];
let sentMessages: any[] = [];

function fakePi() {
	appendedEntries = [];
	sentMessages = [];
	commands = [];
	tools = [];
	events = [];
	return {
		registerCommand: (name: string, def: any) => {
			commands.push({ name, description: def.description, handler: def.handler });
		},
		registerTool: (def: any) => {
			tools.push({ name: def.name, execute: def.execute });
		},
		on: (event: string, handler: any) => {
			events.push({ event, handler });
		},
		appendEntry: (type: string, data: LoopStateData) => {
			appendedEntries.push([type, data]);
		},
		sendMessage: (msg: any, opts: any) => {
			sentMessages.push({ msg, opts });
		},
	} as any;
}

function fakeCtx(overrides: Record<string, any> = {}) {
	const ctx: Record<string, any> = {
		hasUI: true,
		model: { id: "test-model", provider: "openai" },
		modelRegistry: {
			find: vi.fn().mockReturnValue(null),
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
		},
		sessionManager: {
			getEntries: () => [] as any[],
		},
		hasPendingMessages: () => false,
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => true),
			editor: vi.fn(async () => "my custom condition"),
			custom: vi.fn(async (factory: any) => {
				const tui = { requestRender: vi.fn() };
				const theme = {
					fg: (_c: string, s: string) => s,
					bold: (s: string) => s,
				};
				return new Promise((resolve) => {
					factory(tui, theme, {}, (val: any) => resolve(val));
				});
			}),
			setWidget: vi.fn(),
			theme: {
				fg: (_c: string, s: string) => s,
				bold: (s: string) => s,
			},
		},
		...overrides,
	};
	// Deep-merge ui if overrides provided ui
	if (overrides.ui) {
		ctx.ui = { ...ctx.ui, ...overrides.ui };
	}
	return ctx;
}

async function importExtension() {
	const mod = await import("../index");
	return mod.default;
}

function firstAppendedEntry(): LoopStateData | undefined {
	return appendedEntries.at(-1)?.[1];
}

describe("loop extension factory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers a /loop command and signal_loop_success tool", async () => {
		const ext = await importExtension();
		ext(fakePi());
		expect(commands.some((c) => c.name === "loop")).toBe(true);
		expect(tools.some((t) => t.name === "signal_loop_success")).toBe(true);
	});

	it("registers event handlers for agent_end, session_before_compact, session_start", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const eventNames = events.map((e) => e.event);
		expect(eventNames).toContain("agent_end");
		expect(eventNames).toContain("session_before_compact");
		expect(eventNames).toContain("session_start");
	});

	it("/loop custom <condition> persists the state and sends a message", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();
		const handler = commands.find((c) => c.name === "loop")!.handler;

		await handler("custom lint should be clean", ctx);

		const entry = firstAppendedEntry();
		expect(entry).toBeDefined();
		expect(entry?.active).toBe(true);
		expect(entry?.mode).toBe("custom");
		expect(entry?.condition).toBe("lint should be clean");
		// triggerLoopPrompt bumps the count and persists again, so final is 1
		expect(entry?.loopCount).toBe(1);

		expect(sentMessages.length).toBeGreaterThanOrEqual(1);
		expect(sentMessages[0]!.msg.content).toContain("lint should be clean");
		expect(sentMessages[0]!.opts.triggerTurn).toBe(true);
	});

	it("/loop tests parses correctly", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();
		const handler = commands.find((c) => c.name === "loop")!.handler;

		await handler("tests", ctx);

		const entry = firstAppendedEntry();
		expect(entry?.active).toBe(true);
		expect(entry?.mode).toBe("tests");
	});

	it("/loop self parses correctly", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();
		const handler = commands.find((c) => c.name === "loop")!.handler;

		await handler("self", ctx);

		const entry = firstAppendedEntry();
		expect(entry?.active).toBe(true);
		expect(entry?.mode).toBe("self");
	});

	it("/loop with no args shows selector and uses the result", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);

		// Override ui.custom to simulate selecting "tests".
		const ctx = fakeCtx({
			ui: {
				notify: vi.fn(),
				confirm: vi.fn(async () => true),
				editor: vi.fn(),
				custom: vi.fn(async () => "tests"),
				setWidget: vi.fn(),
				theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
			},
		});
		const handler = commands.find((c) => c.name === "loop")!.handler;

		await handler(undefined, ctx);

		const entry = firstAppendedEntry();
		expect(entry?.active).toBe(true);
		expect(entry?.mode).toBe("tests");
	});

	it("signal_loop_success clears active state", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();

		// First start a loop.
		const loopHandler = commands.find((c) => c.name === "loop")!.handler;
		await loopHandler("tests", ctx);
		expect(firstAppendedEntry()?.active).toBe(true);

		// Then signal success.
		const tool = tools.find((t) => t.name === "signal_loop_success")!;
		const result = await tool.execute("tc-1", {}, undefined, undefined, ctx);

		expect(result.content[0].text).toBe("Loop ended.");
		const lastEntry = firstAppendedEntry();
		expect(lastEntry?.active).toBe(false);
	});

	it("signal_loop_success without active loop returns message", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();

		const tool = tools.find((t) => t.name === "signal_loop_success")!;
		const result = await tool.execute("tc-2", {}, undefined, undefined, ctx);

		expect(result.content[0].text).toBe("No active loop is running.");
	});

	it("agent_end triggers loop when active", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx();

		// Start a loop.
		const loopHandler = commands.find((c) => c.name === "loop")!.handler;
		await loopHandler("tests", ctx);
		expect(sentMessages.length).toBe(1); // Initial trigger

		// Fire agent_end.
		const agentEndHandler = events.find((e) => e.event === "agent_end")!.handler;
		await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);

		expect(sentMessages.length).toBe(2); // Triggered again
	});

	it("agent_end asks to break when last assistant was aborted", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);

		const confirm = vi.fn(async () => false); // Say no to break
		const ctx = fakeCtx({
			ui: {
				notify: vi.fn(),
				confirm,
				editor: vi.fn(),
				custom: vi.fn(),
				setWidget: vi.fn(),
				theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
			},
		});

		// Start a loop.
		const loopHandler = commands.find((c) => c.name === "loop")!.handler;
		await loopHandler("tests", ctx);
		expect(sentMessages.length).toBe(1);

		// Fire agent_end with aborted assistant.
		const agentEndHandler = events.find((e) => e.event === "agent_end")!.handler;
		await agentEndHandler({ messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);

		expect(confirm).toHaveBeenCalled();
		expect(sentMessages.length).toBe(2); // Still triggered since user said no
	});

	it("agent_end breaks loop when user confirms after abort", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);

		const confirm = vi.fn(async () => true); // Say yes to break
		const notify = vi.fn();
		const ctx = fakeCtx({
			ui: {
				notify,
				confirm,
				editor: vi.fn(),
				custom: vi.fn(),
				setWidget: vi.fn(),
				theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
			},
		});

		const loopHandler = commands.find((c) => c.name === "loop")!.handler;
		await loopHandler("tests", ctx);
		expect(sentMessages.length).toBe(1);

		const agentEndHandler = events.find((e) => e.event === "agent_end")!.handler;
		await agentEndHandler({ messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);

		expect(confirm).toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith("Loop ended", "info");
		// No additional trigger — loop is broken.
		expect(sentMessages.length).toBe(1);
	});

	it("session_start restores loop state from entries", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);

		const savedState: LoopStateData = { active: true, mode: "tests", prompt: "run tests", loopCount: 5 };
		const ctx = fakeCtx({
			sessionManager: {
				getEntries: () => [
					{ type: "custom", customType: "loop-state", data: savedState },
				],
			},
		});

		const sessionStartHandler = events.find((e) => e.event === "session_start")!.handler;
		await sessionStartHandler({}, ctx);

		// The fire-and-forget summary call needs a tick to resolve.
		await new Promise((r) => setTimeout(r, 10));

		// After restore + summary, the state should have been re-persisted.
		const lastEntry = firstAppendedEntry();
		expect(lastEntry?.active).toBe(true);
		expect(lastEntry?.mode).toBe("tests");
		expect(lastEntry?.summary).toBe("loops until tests pass");
	});
});
