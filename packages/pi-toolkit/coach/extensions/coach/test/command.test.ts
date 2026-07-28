import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";

// Mock complete before any imports
vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: vi.fn(),
}));

interface CapturedCommand {
	name: string;
	description: string;
	handler: (args: string | undefined, ctx: ExtensionCommandContext) => Promise<void>;
}

let commands: CapturedCommand[] = [];
let appendEntryCalls: Array<{ customType: string; data: unknown }> = [];
let sendMessageCalls: Array<{ customType: string; content: string }> = [];

function fakePi(): ExtensionAPI {
	return {
		registerCommand: (name: string, def: { description: string; handler: (args: string | undefined, ctx: ExtensionCommandContext) => Promise<void> }) => {
			commands.push({ name, description: def.description, handler: def.handler });
		},
		appendEntry: <T>(customType: string, data: T) => {
			appendEntryCalls.push({ customType, data });
		},
		sendMessage: (msg: { customType: string; content: string; display: boolean }, _opts?: { triggerTurn: boolean }) => {
			sendMessageCalls.push({ customType: msg.customType, content: msg.content });
		},
	} as unknown as ExtensionAPI;
}

function makeModel(): any {
	return { id: "test-model", provider: "test", model: "test" };
}

function makeTheme() {
	return {
		fg: (_c: string, s: string) => s,
		bold: (s: string) => s,
		dim: (s: string) => s,
		muted: (s: string) => s,
		accent: (s: string) => s,
		warning: (s: string) => s,
		highlight: (s: string) => s,
	};
}

function makeTui() {
	return { requestRender: vi.fn() };
}

/**
 * Build a fake ExtensionCommandContext.
 *
 * The custom() mock actually invokes the factory passed by the handler,
 * so the real CoachModePicker, BorderedLoader, etc. are constructed.
 *
 * scopeSelection: what the scope picker should resolve to.
 *   - undefined → no auto-resolve (use for /coach last or cancel tests)
 *   - null → simulate Esc (cancel)
 *   - "current" | "all" → simulate selection
 */
function fakeCtx(opts: {
	hasUI?: boolean;
	model?: any;
	cwd?: string;
	branchEntries?: SessionEntry[];
	sessionName?: string;
	/** What scope the picker returns. undefined = no auto-resolve. null = cancel. */
	scopeSelection?: string | null;
} = {}): ExtensionCommandContext {
	let customCallIndex = 0;

	const customFn = vi.fn((factory: unknown) => {
		return new Promise((resolve) => {
			const done = (value: unknown) => resolve(value);
			const tui = makeTui();
			const theme = makeTheme();

			// Invoke the real factory (this constructs CoachModePicker, BorderedLoader, etc.)
			(factory as Function)(tui, theme, {}, done);

			const callIndex = customCallIndex;
			customCallIndex++;

			// For the scope picker (first call), auto-resolve based on scopeSelection
			if (callIndex === 0 && opts.scopeSelection !== undefined) {
				Promise.resolve().then(() => {
					done(opts.scopeSelection);
				});
				return;
			}

			// For all other calls (BorderedLoader or presentCoachReport display):
			// - BorderedLoader: collectAndAnalyze will call done() via .then() on a microtask,
			//   which resolves before our setTimeout fires, making this a no-op.
			// - presentCoachReport: no async resolution, so our setTimeout fires and
			//   auto-closes the display.
			setTimeout(() => {
				done(undefined);
			}, 200);
		});
	});

	return {
		hasUI: "hasUI" in opts ? opts.hasUI! : true,
		model: "model" in opts ? opts.model! : makeModel(),
		cwd: opts.cwd ?? "/project",
		sessionManager: {
			getBranch: () => opts.branchEntries ?? [],
			getSessionName: () => opts.sessionName ?? null,
			getSessionDir: () => "/home/user/.pi/agent/sessions/hash",
		},
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true as const, apiKey: "test-key", headers: {} }),
		} as unknown as ModelRegistry,
		ui: {
			notify: vi.fn(),
			custom: customFn,
		} as unknown as ExtensionCommandContext["ui"],
		getContextUsage: () => undefined,
	} as unknown as ExtensionCommandContext;
}

beforeEach(async () => {
	commands = [];
	appendEntryCalls = [];
	sendMessageCalls = [];
	vi.clearAllMocks();

	// Initialize theme so BorderedLoader and other TUI components work
	initTheme({} as any);

	const { complete } = await import("@earendil-works/pi-ai/compat");
	(complete as ReturnType<typeof vi.fn>).mockResolvedValue({
		content: [{ type: "text", text: "# Coaching Report\n\nYou are doing great!" }],
		stopReason: "stop",
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function importExtension() {
	const mod = await import("../index");
	return mod.default;
}

describe("coach extension", () => {
	it("registers a /coach command", async () => {
		const ext = await importExtension();
		ext(fakePi());
		expect(commands).toHaveLength(1);
		expect(commands[0]?.name).toBe("coach");
	});

	it("rejects unknown args", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);
		const ctx = fakeCtx();
		await commands[0]!.handler("unknown", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /coach or /coach last", "warning");
	});

	it("sends message when no UI", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);
		const ctx = fakeCtx({ hasUI: false });
		await commands[0]!.handler("", ctx);
		// When hasUI is false, presentCoachNotice uses sendMessage, not notify
		expect(sendMessageCalls).toHaveLength(1);
		expect(sendMessageCalls[0]?.content).toBe("Coach requires interactive mode");
	});

	it("notifies error when no model", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);
		const ctx = fakeCtx({ model: null });
		await commands[0]!.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("No model selected", "error");
	});

	it("handles /coach last with no saved report", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);
		const ctx = fakeCtx();
		await commands[0]!.handler("last", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'No saved coach report in this session yet. Run "/coach" first.',
			"warning",
		);
	});

	it("handles /coach last with saved report", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);

		const ctx = fakeCtx({
			branchEntries: [
				{
					id: "entry-1",
					type: "custom",
					customType: "coach-report-state",
					data: {
						markdown: "# Old Report\n\nKeep it up!",
						scope: "all",
						createdAt: "2025-01-15T10:30:00Z",
					},
				} as unknown as SessionEntry,
			],
		});

		await commands[0]!.handler("last", ctx);
		expect(ctx.ui.custom).toHaveBeenCalled();
	});

	it("cancels when scope picker returns null", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);

		const ctx = fakeCtx({ scopeSelection: null });

		await commands[0]!.handler("", ctx);
		// No notify, no sendMessage - just silent return
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("happy path: full /coach flow with current scope", async () => {
		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);

		const ctx = fakeCtx({ scopeSelection: "current" });

		await commands[0]!.handler("", ctx);

		// Verify complete was called (LLM was invoked)
		const { complete } = await import("@earendil-works/pi-ai/compat");
		expect(complete).toHaveBeenCalled();

		// Verify report was saved via appendEntry
		expect(appendEntryCalls).toHaveLength(1);
		expect(appendEntryCalls[0]?.customType).toBe("coach-report-state");

		// Verify scope picker + BorderedLoader + report display were shown
		expect(ctx.ui.custom).toHaveBeenCalledTimes(3);
	});

	it("handles LLM error gracefully", async () => {
		const { complete } = await import("@earendil-works/pi-ai/compat");
		(complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("API down"));

		const ext = await importExtension();
		const pi = fakePi();
		ext(pi);

		const ctx = fakeCtx({ scopeSelection: "current" });

		await commands[0]!.handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Coach failed"),
			"error",
		);
	});
});
