/**
 * enhance/test/state.test.ts
 *
 * Real-fs tests for the enhance state module: atomic writes, corruption
 * recovery, preset discovery + parse. The state module reads from
 * `getAgentDir()` at runtime (not module load), so we override
 * PI_CODING_AGENT_DIR per test to redirect to a temp dir. (Setting HOME
 * alone doesn't work in vitest workers because os.homedir() doesn't
 * reflect the change.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as state from "../state";

let tmp: string;
let originalAgentDir: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "pi-config-enhance-test-"));
	originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmp;
});

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	rmSync(tmp, { recursive: true, force: true });
});

function statePath(): string {
	return join(tmp, "pi-config", "enhance", "state.json");
}

describe("enhance state — atomic + corruption-move", () => {
	it("writes state.json atomically under <agentDir>/pi-config/enhance/", async () => {
		await state.mutateState(() => ({ activeName: "concise" }));
		const got = state.readState();
		expect(got.activeName).toBe("concise");
	});

	it("returns empty state when no file exists", () => {
		expect(state.readState()).toEqual({});
	});

	it("moves a corrupt state.json to .corrupt-<timestamp> and returns empty", () => {
		const file = statePath();
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "{ not valid json");
		expect(state.readState()).toEqual({});
		expect(existsSync(file)).toBe(false);
		expect(readdirSync(dirname(file)).some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
	});

	it("treats an activeName of empty string as no name", async () => {
		await state.mutateState(() => ({ activeName: "concise" }));
		await state.mutateState((current) => ({ ...current, activeName: undefined }));
		expect(state.readState().activeName).toBeUndefined();
	});
});

describe("enhance preset loading", () => {
	function presetsDir(): string {
		return join(tmp, "pi-config", "enhance", "presets");
	}

	it("returns an empty list when presets dir is missing", () => {
		const presets = state.loadPresets();
		expect(presets).toEqual([]);
	});

	it("parses a valid markdown preset with frontmatter", () => {
		mkdirSync(presetsDir(), { recursive: true });
		writeFileSync(
			join(presetsDir(), "concise.md"),
			[
				"---",
				"name: concise",
				"description: Tighten the prompt",
				'mode: "append"',
				"---",
				"Rewrite this prompt to be shorter and more direct.",
				"",
			].join("\n"),
		);
		const presets = state.loadPresets();
		expect(presets).toHaveLength(1);
		expect(presets[0]?.name).toBe("concise");
		expect(presets[0]?.description).toBe("Tighten the prompt");
		expect(presets[0]?.mode).toBe("append");
		expect(presets[0]?.systemPrompt).toContain("Rewrite this prompt");
	});

	it("skips files without a name", () => {
		mkdirSync(presetsDir(), { recursive: true });
		writeFileSync(join(presetsDir(), "no-name.md"), "---\ndescription: missing name\n---\nbody\n");
		const presets = state.loadPresets();
		expect(presets).toEqual([]);
	});

	it("defaults mode to append when missing or invalid", () => {
		mkdirSync(presetsDir(), { recursive: true });
		writeFileSync(
			join(presetsDir(), "weird-mode.md"),
			"---\nname: weird-mode\nmode: nonsense\n---\nbody\n",
		);
		const presets = state.loadPresets();
		expect(presets).toHaveLength(1);
		expect(presets[0]?.mode).toBe("append");
	});

	it("skips unreadable / malformed files", () => {
		mkdirSync(presetsDir(), { recursive: true });
		writeFileSync(join(presetsDir(), "broken.md"), "not frontmatter at all");
		const presets = state.loadPresets();
		expect(presets).toEqual([]);
	});
});
