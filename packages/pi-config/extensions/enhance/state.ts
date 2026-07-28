/**
 * enhance/state.ts
 *
 * Persistent state for the enhance extension.
 *
 * Two responsibilities:
 *   1. Atomic read/write of the active preset name to
 *      ~/.pi/agent/pi-config/enhance/state.json.
 *   2. Discovery + parse of user-authored presets at
 *      ~/.pi/agent/pi-config/enhance/presets/*.md.
 *
 * Mutations go through `withFileMutationQueue` from pi to serialize
 * concurrent writes. Corrupt files are moved to `.corrupt-<timestamp>`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { EnhanceStateSchema } from "./schemas";
import type { EnhancePreset, EnhanceState } from "./types";

function configDir(): string {
	return join(getAgentDir(), "pi-config", "enhance");
}

function statePath(): string {
	return join(configDir(), "state.json");
}

function presetsDir(): string {
	return join(configDir(), "presets");
}

const PRESET_MODES = new Set(["append", "replace"] as const);
type PresetMode = "append" | "replace";

// Frontmatter is parsed softly: only `name` is required. `mode` falls
// back to "append" if missing or invalid (a hard failure here would
// drop the whole preset, which is too punitive for a typo in a single
// field). `description` and other unknown fields are ignored.
const FrontmatterShape = Type.Object({
	name: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	mode: Type.Optional(Type.String()),
});

export function readState(): EnhanceState {
	const path = statePath();
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof raw !== "object" || raw === null) return {};
		if (!Value.Check(EnhanceStateSchema, raw)) return {};
		const obj = raw as EnhanceState;
		return typeof obj.activeName === "string" && obj.activeName ? obj : {};
	} catch {
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			renameSync(path, `${path}.corrupt-${stamp}`);
		} catch {
			// best effort
		}
		return {};
	}
}

export async function mutateState(
	transform: (current: EnhanceState) => EnhanceState | undefined,
): Promise<EnhanceState> {
	const path = statePath();
	return withFileMutationQueue(path, async () => {
		const current = readState();
		const next = transform(current);
		if (!next) return current;
		mkdirSync(configDir(), { recursive: true });
		const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
		writeFileSync(tmp, JSON.stringify(next, null, "\t") + "\n");
		renameSync(tmp, path);
		return next;
	});
}

export function loadPresets(): EnhancePreset[] {
	const dir = presetsDir();
	if (!existsSync(dir)) return [];
	const out: EnhancePreset[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const filePath = join(dir, entry.name);
		try {
			const raw = readFileSync(filePath, "utf8");
			const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
			if (!frontmatter || typeof frontmatter !== "object") continue;
			if (!Value.Check(FrontmatterShape, frontmatter)) continue;
			const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
			if (!name) continue;
			const rawMode = frontmatter.mode;
			const mode: PresetMode =
				typeof rawMode === "string" && PRESET_MODES.has(rawMode as PresetMode)
					? (rawMode as PresetMode)
					: "append";
			const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
			out.push({
				name,
				description,
				mode,
				systemPrompt: body.trim(),
				filePath,
			});
		} catch {
			// skip unreadable / malformed
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}
