/**
 * tool.test.ts
 *
 * Integration tests for the tilldone tool via the registered handler.
 * Creates a real state file per test and drives each action through
 * the registerTillDoneTool callback.
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTillDoneTool } from '../tool';
import { statePath } from '../state';
import type { TillDoneState } from '../types';

let FAKE_HOME = "";

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => FAKE_HOME,
	};
});

interface CapturedTool {
	name: string;
	execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: any, ctx?: any) => Promise<{ content: { type: "text"; text: string }[]; details: any }>;
}

let pi: any;
let capturedTool: CapturedTool | undefined;
let sessionId: string;
let ctx: any;

beforeEach(() => {
	FAKE_HOME = mkdtempSync(join(tmpdir(), "tilldone-tool-test-"));
	sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	capturedTool = undefined;
	ctx = {
		ui: { setStatus: vi.fn(), setWidget: vi.fn() },
		sessionManager: { getSessionId: () => sessionId },
	};

	pi = {
		registerTool: vi.fn((def: any) => {
			capturedTool = { name: def.name, execute: def.execute };
		}),
		exec: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "", killed: false }),
	};

	registerTillDoneTool(pi, () => sessionId);
});

afterEach(() => {
	rmSync(FAKE_HOME, { recursive: true, force: true });
});

async function exec(action: string, extra: Record<string, unknown> = {}) {
	if (!capturedTool) throw new Error("Tool not registered");
	return capturedTool.execute("call-1", { action, ...extra }, undefined, undefined, ctx);
}

describe("tilldone tool", () => {
	it("registers the tool", () => {
		expect(capturedTool?.name).toBe("tilldone");
	});

	describe("add", () => {
		it("adds a single task with text", async () => {
			const result = await exec("add", { text: "Do the thing" });
			expect(result.content[0]!.text).toContain("Added task #1");
			expect(result.details.tasks).toHaveLength(1);
			expect(result.details.tasks[0]!.text).toBe("Do the thing");
			expect(result.details.tasks[0]!.status).toBe("idle");
		});

		it("adds multiple tasks with texts[]", async () => {
			const result = await exec("add", { texts: ["A", "B", "C"] });
			expect(result.content[0]!.text).toContain("Added 3 tasks");
			expect(result.details.tasks).toHaveLength(3);
			expect(result.details.tasks[0]!.text).toBe("A");
			expect(result.details.tasks[1]!.text).toBe("B");
			expect(result.details.tasks[2]!.text).toBe("C");
		});

		it("returns error when no text provided", async () => {
			const result = await exec("add");
			expect(result.details.error).toContain("text or texts required");
		});
	});

	describe("done", () => {
		it("marks a task done", async () => {
			await exec("add", { text: "Test" });
			const result = await exec("done", { id: 1 });
			expect(result.details.tasks[0]!.status).toBe("done");
		});

		it("runs gate before marking done", async () => {
			await exec("add", { text: "Gated task", gate: "exit 0" });
			const result = await exec("done", { id: 1 });
			expect(result.details.tasks[0]!.status).toBe("done");
			expect(pi.exec).toHaveBeenCalled();
		});

		it("does NOT mark done when gate fails", async () => {
			pi.exec.mockResolvedValue({ code: 1, stdout: "", stderr: "fail", killed: false });
			await exec("add", { text: "Gated task", gate: "exit 1" });
			const result = await exec("done", { id: 1 });
			expect(result.details.tasks[0]!.status).toBe("idle"); // NOT done
			expect(result.details.error).toContain("Gate failed");
		});

		it("returns error for missing id", async () => {
			const result = await exec("done");
			expect(result.details.error).toContain("id required");
		});

		it("returns error for unknown task id", async () => {
			const result = await exec("done", { id: 999 });
			expect(result.details.error).toContain("not found");
		});
	});

	describe("next", () => {
		it("advances current to done and next idle to inprogress", async () => {
			await exec("add", { texts: ["A", "B", "C"] });
			// Set #1 to inprogress first.
			await exec("update", { id: 1, status: "inprogress" });

			const result = await exec("next");
			const tasks = result.details.tasks as TillDoneState["tasks"];
			expect(tasks.find((t: any) => t.id === 1)!.status).toBe("done");
			expect(tasks.find((t: any) => t.id === 2)!.status).toBe("inprogress");
		});

		it("reports all done when no more idle tasks", async () => {
			await exec("add", { text: "Only task" });
			await exec("update", { id: 1, status: "inprogress" });
			const result = await exec("next");
			expect(result.content[0]!.text).toContain("All tasks done");
		});
	});

	describe("prev", () => {
		it("moves current back to idle and previous to inprogress", async () => {
			await exec("add", { texts: ["A", "B"] });
			await exec("update", { id: 1, status: "done" });
			await exec("update", { id: 2, status: "inprogress" });

			const result = await exec("prev");
			const tasks = result.details.tasks as TillDoneState["tasks"];
			expect(tasks.find((t: any) => t.id === 2)!.status).toBe("idle");
			expect(tasks.find((t: any) => t.id === 1)!.status).toBe("inprogress");
		});

		it("does not write when no task is inprogress", async () => {
			await exec("add", { texts: ["A", "B"] });
			const path = statePath(sessionId);
			const before = statSync(path).mtimeMs;
			await new Promise((resolve) => setTimeout(resolve, 15));
			await exec("prev");
			expect(statSync(path).mtimeMs).toBe(before);
		});
	});

	describe("list", () => {
		it("lists tasks", async () => {
			await exec("add", { texts: ["A", "B"] });
			const result = await exec("list");
			expect(result.content[0]!.text).toContain("#1");
			expect(result.content[0]!.text).toContain("#2");
		});

		it("shows empty message when no tasks", async () => {
			const result = await exec("list");
			expect(result.content[0]!.text).toContain("No tasks defined");
		});

		it("does not write to disk (pure read)", async () => {
			await exec("add", { texts: ["A", "B"] });
			const path = statePath(sessionId);
			const before = statSync(path).mtimeMs;
			await new Promise((resolve) => setTimeout(resolve, 15));
			await exec("list");
			expect(statSync(path).mtimeMs).toBe(before);
		});
	});

	describe("clear", () => {
		it("clears all tasks", async () => {
			await exec("add", { texts: ["A", "B"] });
			const result = await exec("clear");
			expect(result.details.tasks).toHaveLength(0);
			expect(result.details.nextId).toBe(1);
		});
	});

	describe("update", () => {
		it("updates task text", async () => {
			await exec("add", { text: "Old text" });
			const result = await exec("update", { id: 1, text: "New text" });
			expect(result.details.tasks[0]!.text).toBe("New text");
		});

		it("updates task status (enforces single inprogress)", async () => {
			await exec("add", { texts: ["A", "B"] });
			await exec("update", { id: 1, status: "inprogress" });
			// Now set #2 to inprogress — #1 should be auto-paused.
			const result = await exec("update", { id: 2, status: "inprogress" });
			const tasks = result.details.tasks as TillDoneState["tasks"];
			expect(tasks.find((t: any) => t.id === 2)!.status).toBe("inprogress");
			expect(tasks.find((t: any) => t.id === 1)!.status).toBe("idle");
		});

		it("updates task gate", async () => {
			await exec("add", { text: "A" });
			const result = await exec("update", { id: 1, gate: "npm test" });
			expect(result.details.tasks[0]!.gate).toBe("npm test");
		});

		it("clears gate with empty string", async () => {
			await exec("add", { text: "A", gate: "npm test" });
			const result = await exec("update", { id: 1, gate: "" });
			expect(result.details.tasks[0]!.gate).toBeUndefined();
		});

		it("returns error when no fields to update", async () => {
			await exec("add", { text: "A" });
			const result = await exec("update", { id: 1 });
			expect(result.details.error).toContain("at least one of");
		});

		it("does not write when task id not found", async () => {
			await exec("add", { texts: ["A"] });
			const path = statePath(sessionId);
			const before = statSync(path).mtimeMs;
			await new Promise((resolve) => setTimeout(resolve, 15));
			await exec("update", { id: 999, text: "nope" });
			expect(statSync(path).mtimeMs).toBe(before);
		});
	});
});
