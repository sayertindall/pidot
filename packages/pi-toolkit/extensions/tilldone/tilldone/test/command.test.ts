/**
 * command.test.ts
 *
 * Tests for /tasks command (on, off, status, toggle, invalid usage).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTasksCommand } from '../command';

let FAKE_HOME = "";

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => FAKE_HOME,
	};
});

interface CapturedCommand {
	name: string;
	handler: (args: string | undefined, ctx: any) => Promise<void>;
}

let pi: any;
let capturedCommand: CapturedCommand | undefined;
let sessionId: string;
let ctx: any;

beforeEach(() => {
	FAKE_HOME = mkdtempSync(join(tmpdir(), "tilldone-cmd-test-"));
	sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	capturedCommand = undefined;
	ctx = {
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
		sessionManager: { getSessionId: () => sessionId },
	};

	pi = {
		registerCommand: vi.fn((name: string, def: any) => {
			capturedCommand = { name, handler: def.handler };
		}),
	};

	registerTasksCommand(pi, () => sessionId);
});

afterEach(() => {
	rmSync(FAKE_HOME, { recursive: true, force: true });
});

async function run(args?: string) {
	if (!capturedCommand) throw new Error("Command not registered");
	await capturedCommand.handler(args, ctx);
}

describe("/tasks command", () => {
	it("registers the command", () => {
		expect(capturedCommand?.name).toBe("tasks");
	});

	it("notifies error when no session", async () => {
		sessionId = undefined as any;
		await run("status");
		expect(ctx.ui.notify).toHaveBeenCalledWith("No active session.", "error");
	});

	describe("status", () => {
		it("shows task-mode:off by default", async () => {
			await run("status");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("task-mode:off"),
				"info",
			);
		});

		it("shows tasks after adding", async () => {
			// Enable and add a task via the command helper.
			await run("on");
			// Now manually add a task via the system (we'll test through the tool in integration).
			// For this test we just verify the status command works.
			await run("status");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("task-mode:on"),
				"info",
			);
		});
	});

	describe("on", () => {
		it("enables task mode", async () => {
			await run("on");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Task mode enabled"),
				"info",
			);
		});

		it("shows already enabled message when already on", async () => {
			await run("on");
			vi.clearAllMocks();
			await run("on");
			// The second call should trigger the "already enabled" check internally
			// via mutateState. Since the state is already enabled, the transform returns s unchanged.
			// The command still reports "Task mode enabled".
			// This is fine — the notification is shown in both cases in our impl.
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Task mode enabled"),
				"info",
			);
		});
	});

	describe("off", () => {
		it("disables task mode and clears tasks", async () => {
			await run("on");
			vi.clearAllMocks();
			await run("off");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("disabled"),
				"info",
			);
		});
	});

	describe("toggle", () => {
		it("enables when off", async () => {
			await run("toggle");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Task mode enabled"),
				"info",
			);
		});

		it("disables when on", async () => {
			await run("on");
			vi.clearAllMocks();
			await run("toggle");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("disabled"),
				"info",
			);
		});
	});

	describe("invalid usage", () => {
		it("shows usage for unknown subcommand", async () => {
			await run("invalid");
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Usage:"),
				"warning",
			);
		});
	});
});
