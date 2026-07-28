/**
 * shell/config.ts
 *
 * `interactive-shell.json` loader + defaults. Same keys, same defaults, same
 * lookup order (project `.pi/interactive-shell.json` over global
 * `~/.pi/agent/interactive-shell.json`) as the old package — §8 of the spec
 * keeps the public config surface unchanged. Two additions: `gemini` joins
 * the spawn agent union (§2), and `worktreePolicy` / `worktreeBaseDir`
 * default to the old leak-forever behavior (`keep`, §7) so nothing breaks
 * for existing configs that never mentioned it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SpawnAgent, WorktreePolicy } from "./types";

export interface SpawnConfig {
	defaultAgent: SpawnAgent;
	shortcut: string;
	commands: Record<SpawnAgent, string>;
	defaultArgs: Record<SpawnAgent, string[]>;
	worktree: boolean;
	worktreeBaseDir?: string;
	worktreePolicy: WorktreePolicy;
}

export interface DispatchConfig {
	exitAutoCloseDelay: number;
	overlayWidthPercent: number;
	overlayHeightPercent: number;
	focusShortcut: string;
	spawn: SpawnConfig;
	scrollbackLines: number;
	ansiReemit: boolean;
	handoffPreviewEnabled: boolean;
	handoffPreviewLines: number;
	handoffPreviewMaxChars: number;
	handoffSnapshotEnabled: boolean;
	handoffSnapshotLines: number;
	handoffSnapshotMaxChars: number;
	transferLines: number;
	transferMaxChars: number;
	completionNotifyLines: number;
	completionNotifyMaxChars: number;
	handsFreeUpdateMode: "on-quiet" | "interval";
	handsFreeUpdateInterval: number;
	handsFreeQuietThreshold: number;
	autoExitGracePeriod: number;
	handsFreeUpdateMaxChars: number;
	handsFreeMaxTotalChars: number;
	minQueryIntervalSeconds: number;
	runRetentionDays: number;
}

const SPAWN_AGENTS: readonly SpawnAgent[] = ["pi", "codex", "claude", "cursor", "gemini"];

const DEFAULT_SPAWN_CONFIG: SpawnConfig = {
	defaultAgent: "pi",
	shortcut: "alt+shift+p",
	commands: {
		pi: "pi",
		codex: "codex",
		claude: "claude",
		cursor: "agent",
		gemini: "gemini",
	},
	defaultArgs: {
		pi: [],
		codex: [],
		claude: [],
		cursor: ["--model", "composer-2-fast"],
		gemini: [],
	},
	worktree: false,
	worktreeBaseDir: undefined,
	worktreePolicy: "keep",
};

const DEFAULT_CONFIG: DispatchConfig = {
	exitAutoCloseDelay: 10,
	overlayWidthPercent: 95,
	overlayHeightPercent: 60,
	focusShortcut: "alt+shift+f",
	spawn: DEFAULT_SPAWN_CONFIG,
	scrollbackLines: 5000,
	ansiReemit: true,
	handoffPreviewEnabled: true,
	handoffPreviewLines: 30,
	handoffPreviewMaxChars: 2000,
	handoffSnapshotEnabled: false,
	handoffSnapshotLines: 200,
	handoffSnapshotMaxChars: 12000,
	transferLines: 200,
	transferMaxChars: 20000,
	completionNotifyLines: 50,
	completionNotifyMaxChars: 5000,
	handsFreeUpdateMode: "on-quiet",
	handsFreeUpdateInterval: 60000,
	handsFreeQuietThreshold: 8000,
	autoExitGracePeriod: 15000,
	handsFreeUpdateMaxChars: 1500,
	handsFreeMaxTotalChars: 100000,
	minQueryIntervalSeconds: 60,
	runRetentionDays: 7,
};

export function loadConfig(cwd: string): DispatchConfig {
	const projectPath = join(cwd, ".pi", "interactive-shell.json");
	const globalPath = join(getAgentDir(), "interactive-shell.json");

	let globalConfig: Partial<DispatchConfig> = {};
	let projectConfig: Partial<DispatchConfig> = {};

	if (existsSync(globalPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalPath, "utf-8"));
		} catch (error) {
			console.error(`Warning: Could not parse ${globalPath}:`, error);
		}
	}

	if (existsSync(projectPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectPath, "utf-8"));
		} catch (error) {
			console.error(`Warning: Could not parse ${projectPath}:`, error);
		}
	}

	const mergedSpawn = mergeSpawnConfig(globalConfig.spawn, projectConfig.spawn);
	const merged = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig, spawn: mergedSpawn };

	return {
		...merged,
		exitAutoCloseDelay: clampInt(merged.exitAutoCloseDelay, DEFAULT_CONFIG.exitAutoCloseDelay, 0, 60),
		overlayWidthPercent: clampPercent(merged.overlayWidthPercent, DEFAULT_CONFIG.overlayWidthPercent),
		overlayHeightPercent: clampInt(merged.overlayHeightPercent, DEFAULT_CONFIG.overlayHeightPercent, 20, 90),
		focusShortcut: resolveShortcut(merged.focusShortcut, DEFAULT_CONFIG.focusShortcut),
		spawn: mergedSpawn,
		scrollbackLines: clampInt(merged.scrollbackLines, DEFAULT_CONFIG.scrollbackLines, 200, 50000),
		ansiReemit: merged.ansiReemit !== false,
		handoffPreviewEnabled: merged.handoffPreviewEnabled !== false,
		handoffPreviewLines: clampInt(merged.handoffPreviewLines, DEFAULT_CONFIG.handoffPreviewLines, 0, 500),
		handoffPreviewMaxChars: clampInt(
			merged.handoffPreviewMaxChars,
			DEFAULT_CONFIG.handoffPreviewMaxChars,
			0,
			50000,
		),
		handoffSnapshotEnabled: merged.handoffSnapshotEnabled === true,
		handoffSnapshotLines: clampInt(merged.handoffSnapshotLines, DEFAULT_CONFIG.handoffSnapshotLines, 0, 5000),
		handoffSnapshotMaxChars: clampInt(
			merged.handoffSnapshotMaxChars,
			DEFAULT_CONFIG.handoffSnapshotMaxChars,
			0,
			200000,
		),
		transferLines: clampInt(merged.transferLines, DEFAULT_CONFIG.transferLines, 10, 1000),
		transferMaxChars: clampInt(merged.transferMaxChars, DEFAULT_CONFIG.transferMaxChars, 1000, 100000),
		completionNotifyLines: clampInt(merged.completionNotifyLines, DEFAULT_CONFIG.completionNotifyLines, 10, 500),
		completionNotifyMaxChars: clampInt(
			merged.completionNotifyMaxChars,
			DEFAULT_CONFIG.completionNotifyMaxChars,
			1000,
			50000,
		),
		handsFreeUpdateMode: merged.handsFreeUpdateMode === "interval" ? "interval" : "on-quiet",
		handsFreeUpdateInterval: clampInt(
			merged.handsFreeUpdateInterval,
			DEFAULT_CONFIG.handsFreeUpdateInterval,
			5000,
			300000,
		),
		handsFreeQuietThreshold: clampInt(
			merged.handsFreeQuietThreshold,
			DEFAULT_CONFIG.handsFreeQuietThreshold,
			1000,
			30000,
		),
		autoExitGracePeriod: clampInt(merged.autoExitGracePeriod, DEFAULT_CONFIG.autoExitGracePeriod, 5000, 120000),
		handsFreeUpdateMaxChars: clampInt(
			merged.handsFreeUpdateMaxChars,
			DEFAULT_CONFIG.handsFreeUpdateMaxChars,
			500,
			50000,
		),
		handsFreeMaxTotalChars: clampInt(
			merged.handsFreeMaxTotalChars,
			DEFAULT_CONFIG.handsFreeMaxTotalChars,
			10000,
			1000000,
		),
		minQueryIntervalSeconds: clampInt(
			merged.minQueryIntervalSeconds,
			DEFAULT_CONFIG.minQueryIntervalSeconds,
			5,
			300,
		),
		runRetentionDays: clampInt(merged.runRetentionDays, DEFAULT_CONFIG.runRetentionDays, 1, 90),
	};
}

function mergeSpawnConfig(globalValue: unknown, projectValue: unknown): SpawnConfig {
	const globalSpawn = isPlainObject(globalValue) ? globalValue : undefined;
	const projectSpawn = isPlainObject(projectValue) ? projectValue : undefined;
	const globalCommands = isPlainObject(globalSpawn?.commands) ? globalSpawn.commands : undefined;
	const projectCommands = isPlainObject(projectSpawn?.commands) ? projectSpawn.commands : undefined;
	const globalArgs = isPlainObject(globalSpawn?.defaultArgs) ? globalSpawn.defaultArgs : undefined;
	const projectArgs = isPlainObject(projectSpawn?.defaultArgs) ? projectSpawn.defaultArgs : undefined;

	const mergedCommands = {} as Record<SpawnAgent, string>;
	const mergedDefaultArgs = {} as Record<SpawnAgent, string[]>;
	for (const agent of SPAWN_AGENTS) {
		mergedCommands[agent] = resolveCommand(
			projectCommands?.[agent] ?? globalCommands?.[agent],
			DEFAULT_SPAWN_CONFIG.commands[agent],
		);
		mergedDefaultArgs[agent] = resolveStringArray(
			projectArgs?.[agent] ?? globalArgs?.[agent],
			DEFAULT_SPAWN_CONFIG.defaultArgs[agent],
		);
	}

	return {
		defaultAgent: resolveSpawnAgent(
			projectSpawn?.defaultAgent ?? globalSpawn?.defaultAgent,
			DEFAULT_SPAWN_CONFIG.defaultAgent,
		),
		shortcut: resolveShortcut(projectSpawn?.shortcut ?? globalSpawn?.shortcut, DEFAULT_SPAWN_CONFIG.shortcut),
		commands: mergedCommands,
		defaultArgs: mergedDefaultArgs,
		worktree: resolveBoolean(projectSpawn?.worktree ?? globalSpawn?.worktree, DEFAULT_SPAWN_CONFIG.worktree),
		worktreeBaseDir: resolveOptionalString(projectSpawn?.worktreeBaseDir ?? globalSpawn?.worktreeBaseDir),
		worktreePolicy: resolveWorktreePolicy(
			projectSpawn?.worktreePolicy ?? globalSpawn?.worktreePolicy,
			DEFAULT_SPAWN_CONFIG.worktreePolicy,
		),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSpawnAgent(value: unknown, fallback: SpawnAgent): SpawnAgent {
	return typeof value === "string" && (SPAWN_AGENTS as readonly string[]).includes(value)
		? (value as SpawnAgent)
		: fallback;
}

function resolveWorktreePolicy(value: unknown, fallback: WorktreePolicy): WorktreePolicy {
	return value === "keep" || value === "prune-on-success" || value === "prune-always" ? value : fallback;
}

function resolveCommand(value: unknown, fallback: string): string {
	return resolveShortcut(typeof value === "string" ? value : undefined, fallback);
}

function resolveStringArray(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return fallback;
	return value;
}

function resolveBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function resolveOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function clampPercent(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	return Math.min(100, Math.max(10, value));
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	const rounded = Math.trunc(value);
	return Math.min(max, Math.max(min, rounded));
}

function resolveShortcut(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}
