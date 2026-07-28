/**
 * index.test.ts
 *
 * Integration test for the LLM-ranking find-session extension factory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedCommand {
	name: string;
	description: string;
	handler: (args: string | undefined, ctx: any) => Promise<void>;
}

interface FakeCtx {
	hasUI: boolean;
	model: unknown;
	modelRegistry: any;
	cwd: string;
	sessionManager: { getSessionFile: () => string | null };
	ui: {
		notify: ReturnType<typeof vi.fn>;
		custom: ReturnType<typeof vi.fn>;
	};
	waitForIdle: ReturnType<typeof vi.fn>;
	switchSession: ReturnType<typeof vi.fn>;
}

let tmp: string;
let commands: CapturedCommand[] = [];

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "find-session-llm-"));
	commands = [];
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function fakePi(): import("@earendil-works/pi-coding-agent").ExtensionAPI {
	const exec = vi.fn(async (cmd: string, args: readonly string[], opts?: any) => {
		if (cmd === "git" && args[0] === "rev-parse") {
			// Git root detection: return the cwd as root
			return { code: 0, stdout: (opts?.cwd ?? "/fake") + "\n", stderr: "", killed: false };
		}
		return { code: 1, stdout: "", stderr: "not found", killed: false };
	});

	return {
		registerCommand: (name: string, def: any) => {
			commands.push({ name, description: def.description, handler: def.handler });
		},
		exec,
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
}

function fakeCtx(overrides: Partial<FakeCtx> = {}): FakeCtx {
	const switchSession = vi.fn(async (_path: string) => ({ cancelled: false }));
	const waitForIdle = vi.fn(async () => undefined);
	const notify = vi.fn();
	// custom() returns a promise that resolves when the factory's done() is called.
	const customFn = vi.fn((_factory: any) => new Promise(() => {}));
	const result: FakeCtx = {
		hasUI: true,
		model: { id: "test-model", name: "Test Model" },
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "fake-key", headers: {} })),
		},
		cwd: tmp,
		sessionManager: { getSessionFile: () => null },
		ui: { notify, custom: customFn },
		waitForIdle,
		switchSession,
	};
	if (overrides.hasUI !== undefined) result.hasUI = overrides.hasUI;
	if (overrides.model !== undefined) result.model = overrides.model;
	if (overrides.modelRegistry !== undefined) result.modelRegistry = overrides.modelRegistry;
	if (overrides.cwd !== undefined) result.cwd = overrides.cwd;
	return result;
}

async function importExtension() {
	const mod = await import("../index");
	return mod.default;
}

describe("find-session extension factory (LLM ranking)", () => {
	it("registers a /find-session command", async () => {
		const ext = await importExtension();
		ext(fakePi());
		expect(commands).toHaveLength(1);
		expect(commands.at(-1)?.name).toBe("find-session");
	});

	it("notifies on empty or whitespace-only query", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx();
		// An empty/whitespace query opens the TUI (calls custom) — it doesn't error.
		void commands.at(-1)!.handler("  ", ctx);
		// Let the handler run enough to call custom().
		await new Promise(r => setTimeout(r, 10));
		expect(ctx.ui.custom).toHaveBeenCalled();
	});

	it("notifies error when no UI", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx({ hasUI: false });
		await commands.at(-1)!.handler("test", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"/find-session requires interactive mode",
			"error",
		);
	});

	it("notifies error when no model", async () => {
		const ext = await importExtension();
		ext(fakePi());
		const ctx = fakeCtx({ model: null });
		await commands.at(-1)!.handler("test", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"/find-session requires an active model",
			"error",
		);
	});
});
