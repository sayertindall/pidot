/**
 * index.test.ts
 *
 * Integration test for the qna extension factory. Drives the /qna
 * command end-to-end with a fake pi, fake ctx, and fake modelRegistry.
 * Covers: empty branch, incomplete last message, local extraction
 * success, LLM extraction success, no questions found, cancel,
 * submit, no-UI, no-model.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Editor from pi-tui so the QnAComponent can be constructed
// in node tests. The real Editor requires a TUI with `rows` and other
// internals; for the integration test we just need the editor to behave
// like a string buffer. The onChange callback we set in the component
// needs to be invoked when setText is called so component state syncs.
vi.mock("@earendil-works/pi-tui", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-tui");
	return {
		...actual,
		Editor: class FakeEditor {
			private text = "";
			constructor(_tui: any, _theme: any) {}
			getText() {
				return this.text;
			}
			setText(t: string) {
				this.text = t;
				if ((this as any).onChange) (this as any).onChange();
			}
			render(_width: number) {
				// Return a top border, one content line, bottom border.
				return ["─".repeat(_width), this.text, "─".repeat(_width)];
			}
			handleInput(_data: string) {}
		},
	};
});

// Mock BorderedLoader from pi-coding-agent. The real one calls
// `theme.fg(...)` and accesses global theme state. The factory only
// needs `signal` and `onAbort` to work.
vi.mock("@earendil-works/pi-coding-agent", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-coding-agent");
	return {
		...actual,
		BorderedLoader: class FakeBorderedLoader {
			signal = new AbortController().signal;
			onAbort: (() => void) | null = null;
			constructor(_tui: any, _theme: any, _label: string) {}
			render(_width: number) {
				return [""];
			}
			handleInput(_data: string) {}
			invalidate() {}
		},
	};
});

// Mock the LLM `complete` so LLM-extraction tests don't need real
// network. Returns a default "no questions" response; specific tests
// override via `__setCompleteResult`.
vi.mock("@earendil-works/pi-ai/compat", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-ai/compat");
	let result: any = {
		stopReason: "stop",
		content: [{ type: "text", text: JSON.stringify({ questions: [] }) }],
	};
	(globalThis as any).__setCompleteResult = (r: any) => {
		result = r;
	};
	return {
		...actual,
		complete: async () => result,
	};
});

interface CapturedCommand {
	name: string;
	description: string;
	handler: (args: string | undefined, ctx: any) => Promise<void>;
}

interface CapturedCustomMount {
	tui: any;
	theme: any;
	keybindings: any;
	done: (selection: any) => void;
	factory: any;
	component: any;
}

let commands: CapturedCommand[] = [];
let customMounts: CapturedCustomMount[] = [];

beforeEach(() => {
	commands = [];
	customMounts = [];
});

afterEach(() => {
	vi.restoreAllMocks();
});

interface FakeCtx {
	hasUI: boolean;
	model: any;
	modelRegistry: any;
	sessionManager: { getBranch: () => any[] };
	ui: {
		notify: ReturnType<typeof vi.fn>;
		custom: ReturnType<typeof vi.fn>;
	};
	sendMessage: ReturnType<typeof vi.fn>;
}

function fakePi() {
	return {
		registerCommand: (name: string, def: any) => {
			commands.push({ name, description: def.description, handler: def.handler });
		},
		sendMessage: vi.fn(),
	} as any;
}

function fakeCtx(overrides: Partial<FakeCtx> = {}): FakeCtx {
	const sendMessage = vi.fn();
	const notify = vi.fn();
	const customFn = vi.fn((factory: any) => {
		const tui = { requestRender: vi.fn() };
		const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s };
		let resolveFn: ((sel: any) => void) | null = null;
		const promise = new Promise<any>((resolve) => {
			resolveFn = resolve;
		});
		const done = (sel: any) => {
			if (resolveFn) resolveFn(sel);
		};
		const component = factory(tui, theme, {}, done);
		customMounts.push({ tui, theme, keybindings: {}, done, factory, component });
		return promise;
	}) as any;
	const result: FakeCtx = {
		hasUI: true,
		model: { id: "test-model" },
		modelRegistry: { find: vi.fn(), getApiKeyAndHeaders: vi.fn() },
		sessionManager: { getBranch: () => [] },
		ui: { notify, custom: customFn },
		sendMessage,
	};
	if (overrides.hasUI !== undefined) result.hasUI = overrides.hasUI;
	if (overrides.model !== undefined) result.model = overrides.model;
	if (overrides.modelRegistry !== undefined) result.modelRegistry = overrides.modelRegistry;
	if (overrides.sessionManager !== undefined) result.sessionManager = overrides.sessionManager;
	return result;
}

function driveSelection(selection: any) {
	const last = customMounts.at(-1);
	if (!last) throw new Error("No custom mount to drive");
	last.done(selection);
}

async function importExtension() {
	const mod = await import("../index");
	return mod.default;
}

describe("qna extension factory", () => {
	it("registers a /qna command", async () => {
		const ext = await importExtension();
		ext(fakePi());
		expect(commands.at(-1)?.name).toBe("qna");
	});

	it("notifies error when no UI", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx({ hasUI: false });
		await commands.at(-1)!.handler(undefined, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("answer requires interactive mode", "error");
	});

	it("notifies error when no model", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx({ model: null });
		await commands.at(-1)!.handler(undefined, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("No model selected", "error");
	});

	it("notifies error when no assistant messages", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx();
		await commands.at(-1)!.handler(undefined, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("No assistant messages found", "error");
	});

	it("notifies error when last assistant message was incomplete", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx({
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "partial" }],
							stopReason: "aborted",
						},
					},
				],
			},
		});
		await commands.at(-1)!.handler(undefined, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("incomplete"),
			"error",
		);
	});

	it("uses local extraction when a question is present in the last message", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx({
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "What is your name?\nTell me about it." }],
							stopReason: "stop",
						},
					},
				],
			},
		});
		const handlerPromise = commands.at(-1)!.handler(undefined, ctx);
		// The answer TUI should mount with one question. Submit it.
		await new Promise((r) => setTimeout(r, 10));
		driveSelection("Q: What is your name?\nA: test answer");
		await handlerPromise;

		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		const call = pi.sendMessage.mock.calls[0]?.[0];
		expect(call.customType).toBe("answers");
		expect(call.content).toContain("test answer");
		expect(call.display).toBe(true);
		expect(pi.sendMessage.mock.calls[0]?.[1]).toEqual({ triggerTurn: true });
	});

	it("falls back to LLM extraction when local finds nothing", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		// Text with no `?` lines — local extraction finds nothing.
		const ctx = fakeCtx({
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "Here is some prose without question marks." }],
							stopReason: "stop",
						},
					},
				],
			},
			modelRegistry: {
				find: vi.fn(() => undefined),
				getApiKeyAndHeaders: vi.fn(async (_: any) => ({
					ok: true,
					apiKey: "k",
					headers: {},
				})),
			},
		});
		// Mock the @earendil-works/pi-ai/compat `complete` so the LLM
		// extraction returns a valid ExtractionResult.
		const compat = await import("@earendil-works/pi-ai/compat");
		vi.spyOn(compat, "complete").mockResolvedValue({
			stopReason: "stop",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						questions: [{ question: "Extracted by LLM?" }],
					}),
				},
			],
		} as any);

		const handlerPromise = commands.at(-1)!.handler(undefined, ctx);
		await new Promise((r) => setTimeout(r, 10));
		customMounts[0]?.done({
			questions: [{ question: "Extracted by LLM?" }],
		});
		await new Promise((r) => setTimeout(r, 10));
		driveSelection("Q: Extracted by LLM?\nA: yes");
		await handlerPromise;

		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		expect(pi.sendMessage.mock.calls[0]?.[0].content).toContain("Extracted by LLM?");
		expect(pi.sendMessage.mock.calls[0]?.[0].content).toContain("yes");
	});

	it("notifies info when LLM extraction finds no questions", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx({
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "no question marks here" }],
							stopReason: "stop",
						},
					},
				],
			},
			modelRegistry: {
				find: vi.fn(() => undefined),
				getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k" })),
			},
		});
		// Mock the LLM to return an empty questions array.
		(globalThis as any).__setCompleteResult?.({
			stopReason: "stop",
			content: [
				{
					type: "text",
					text: JSON.stringify({ questions: [] }),
				},
			],
		});

		const handlerPromise = commands.at(-1)!.handler(undefined, ctx);
		await new Promise((r) => setTimeout(r, 10));
		await handlerPromise;

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"No questions found in the last message",
			"info",
		);
	});

	it("notifies info when user cancels the answer TUI", async () => {
		const pi = fakePi();
		const ext = await importExtension();
		ext(pi);
		const ctx = fakeCtx({
			sessionManager: {
				getBranch: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "A question for you?" }],
							stopReason: "stop",
						},
					},
				],
			},
		});
		const handlerPromise = commands.at(-1)!.handler(undefined, ctx);
		await new Promise((r) => setTimeout(r, 10));
		driveSelection(null);
		await handlerPromise;

		expect(ctx.ui.notify).toHaveBeenCalledWith("Cancelled", "info");
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});
});
