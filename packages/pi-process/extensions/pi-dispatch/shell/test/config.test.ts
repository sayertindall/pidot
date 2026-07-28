import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mutable container so the mock closure sees per-test updates
const mockState = vi.hoisted(() => ({ dir: "/tmp/mock-agent-dir" }));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => mockState.dir,
}));

import { loadConfig } from "../config";

describe("loadConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "dispatch-config-test-"));
		mockState.dir = tmpDir;
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns defaults when no config files exist", () => {
		const config = loadConfig("/fake-cwd");
		expect(config.spawn.defaultAgent).toBe("pi");
		expect(config.spawn.commands.pi).toBe("pi");
		expect(config.exitAutoCloseDelay).toBe(10);
		expect(config.overlayWidthPercent).toBe(95);
	});

	it("loads global config", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ exitAutoCloseDelay: 30 }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.exitAutoCloseDelay).toBe(30);
	});

	it("project config overrides global config", () => {
		const projectDir = join(tmpDir, "project");
		mkdirSync(join(projectDir, ".pi"), { recursive: true });

		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ exitAutoCloseDelay: 30 }),
		);
		writeFileSync(
			join(projectDir, ".pi", "interactive-shell.json"),
			JSON.stringify({ exitAutoCloseDelay: 5 }),
		);

		const config = loadConfig(projectDir);
		expect(config.exitAutoCloseDelay).toBe(5);
	});

	it("clamps exitAutoCloseDelay to [0, 60]", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ exitAutoCloseDelay: 999 }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.exitAutoCloseDelay).toBe(60);
	});

	it("clamps overlayHeightPercent to [20, 90]", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ overlayHeightPercent: 5 }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.overlayHeightPercent).toBe(20);
	});

	it("clamps overlayWidthPercent to [10, 100]", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ overlayWidthPercent: 5 }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.overlayWidthPercent).toBe(10);
	});

	it("falls back to defaults for non-numeric values", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ exitAutoCloseDelay: "not a number" }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.exitAutoCloseDelay).toBe(10);
	});

	it("handles corrupt global config gracefully", () => {
		writeFileSync(join(tmpDir, "interactive-shell.json"), "not json{{{");
		const config = loadConfig("/fake-cwd");
		expect(config.exitAutoCloseDelay).toBe(10);
	});

	it("merges spawn config with defaults", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({
				spawn: { defaultAgent: "claude", commands: { claude: "claude-custom" } },
			}),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.spawn.defaultAgent).toBe("claude");
		expect(config.spawn.commands.claude).toBe("claude-custom");
		expect(config.spawn.commands.pi).toBe("pi");
	});

	it("rejects invalid spawn agent", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ spawn: { defaultAgent: "invalid-agent" } }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.spawn.defaultAgent).toBe("pi");
	});

	it("resolves worktree policy", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ spawn: { worktreePolicy: "prune-on-success" } }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.spawn.worktreePolicy).toBe("prune-on-success");
	});

	it("resolves handsFreeUpdateMode to on-quiet for invalid value", () => {
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ handsFreeUpdateMode: "invalid" }),
		);
		const config = loadConfig("/fake-cwd");
		expect(config.handsFreeUpdateMode).toBe("on-quiet");
	});

	it("validates worktreePolicy values", () => {
		for (const valid of ["keep", "prune-on-success", "prune-always"] as const) {
			writeFileSync(
				join(tmpDir, "interactive-shell.json"),
				JSON.stringify({ spawn: { worktreePolicy: valid } }),
		);
		expect(loadConfig("/fake-cwd").spawn.worktreePolicy).toBe(valid);
		}
		writeFileSync(
			join(tmpDir, "interactive-shell.json"),
			JSON.stringify({ spawn: { worktreePolicy: "destroy-all" } }),
		);
		expect(loadConfig("/fake-cwd").spawn.worktreePolicy).toBe("keep");
	});
});
