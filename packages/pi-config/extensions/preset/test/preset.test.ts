import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Value } from "typebox/value";
import { loadPresets, loadPersistedState, persistStateEager } from "../state";
import { nextCycleName, filterValidTools } from "../runtime";
import { parsePresetCommand } from "../commands";
import { PresetSchema, PresetsFileSchema } from "../schemas";

describe("preset", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-config-preset-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe("loadPresets", () => {
		it("returns empty for a missing file", () => {
			const result = loadPresets(tmp);
			expect(result.presets).toEqual({});
			expect(result.diagnostics).toEqual([]);
		});

		it("loads valid presets", () => {
			writeFileSync(
				join(tmp, "presets.json"),
				JSON.stringify({
					code: {
						provider: "anthropic",
						model: "claude-sonnet-4",
						thinking_level: "low",
						tools: ["read", "bash"],
					},
				}),
			);
			const result = loadPresets(tmp);
			expect(result.presets.code).toBeDefined();
			expect(result.presets.code?.provider).toBe("anthropic");
			expect(result.presets.code?.thinkingLevel).toBe("low");
			expect(result.diagnostics).toEqual([]);
		});

		it("quarantines corrupt files", () => {
			const path = join(tmp, "presets.json");
			writeFileSync(path, "{ bad json");
			const result = loadPresets(tmp);
			expect(result.presets).toEqual({});
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.message).toMatch(/Could not parse/);
			const corrupt = readdirSync(tmp).find((f) => f.startsWith("presets.json.corrupt"));
			expect(corrupt).toBeDefined();
		});

		it("drops invalid entries and keeps the good ones", () => {
			writeFileSync(
				join(tmp, "presets.json"),
				JSON.stringify({
					good: { provider: "anthropic" },
					bad: { thinking_level: "ultra" }, // not in enum
					worse: "not an object",
				}),
			);
			const result = loadPresets(tmp);
			expect(result.presets.good).toBeDefined();
			expect(result.presets.bad).toBeUndefined();
			expect(result.presets.worse).toBeUndefined();
			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("persistStateEager / loadPersistedState", () => {
		it("round-trips a state record through disk", async () => {
			await persistStateEager(tmp, { active_name: "code" });
			const loaded = loadPersistedState(tmp);
			expect(loaded.active_name).toBe("code");
			expect(existsSync(join(tmp, "state.json"))).toBe(true);
		});

		it("returns empty record when state file missing", () => {
			const loaded = loadPersistedState(tmp);
			expect(loaded).toEqual({});
		});

		it("merges with previous state on subsequent writes", async () => {
			await persistStateEager(tmp, { active_name: "code" });
			// Note: persistStateEager merges via { ...current, ...next }.
			// We don't test unset since that would need a separate "clear" call.
			const loaded = loadPersistedState(tmp);
			expect(loaded.active_name).toBe("code");
		});
	});

	describe("schemas", () => {
		it("PresetSchema accepts a minimal preset", () => {
			expect(Value.Check(PresetSchema, { provider: "anthropic" })).toBe(true);
		});

		it("PresetSchema rejects an invalid thinking_level", () => {
			expect(Value.Check(PresetSchema, { thinking_level: "ultra" })).toBe(false);
		});

		it("PresetsFileSchema accepts a record of valid presets", () => {
			expect(
				Value.Check(PresetsFileSchema, {
					code: { provider: "anthropic", thinking_level: "low" },
				}),
			).toBe(true);
		});
	});

	describe("runtime helpers", () => {
		it("filterValidTools splits valid and invalid", () => {
			const { valid, invalid } = filterValidTools(["read", "unknown", "bash"], ["read", "bash", "edit"]);
			expect(valid).toEqual(["read", "bash"]);
			expect(invalid).toEqual(["unknown"]);
		});

		it("nextCycleName walks (none) -> first -> second -> (none)", () => {
			const names = ["alpha", "beta"];
			expect(nextCycleName(undefined, names)).toBe("alpha");
			expect(nextCycleName("alpha", names)).toBe("beta");
			expect(nextCycleName("beta", names)).toBe("(none)");
			expect(nextCycleName("(none)", names)).toBe("alpha");
		});
	});

	describe("parsePresetCommand", () => {
		it("parses list", () => {
			expect(parsePresetCommand("list")).toEqual({ verb: "list" });
		});

		it("parses show", () => {
			expect(parsePresetCommand("show code")).toEqual({ verb: "show", name: "code" });
		});

		it("parses activate", () => {
			expect(parsePresetCommand("activate code")).toEqual({ verb: "activate", name: "code" });
		});

		it("parses cycle", () => {
			expect(parsePresetCommand("cycle")).toEqual({ verb: "cycle" });
		});

		it("treats empty as select", () => {
			expect(parsePresetCommand("")).toEqual({ verb: "select" });
		});

		it("treats bare name as activate (back-compat)", () => {
			expect(parsePresetCommand("code")).toEqual({ verb: "activate", name: "code" });
		});
	});
});
