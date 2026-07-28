import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies — hoisted so vi.mock can reference them
const MOCK_ICON_GLYPH_KEYS = vi.hoisted(() => [
	"cwd",
	"git",
	"ahead",
	"behind",
	"diverged",
	"conflicted",
	"untracked",
	"stashed",
	"modified",
	"staged",
	"renamed",
	"deleted",
	"typechanged",
	"cacheHit",
	"editorPrompt",
	"rail",
	"username",
	"time",
	"os",
	"package",
]);

const MOCK_NERD_DEFAULT_ICONS = vi.hoisted(() => ({
	cwd: "",
	git: "\uF418",
	ahead: "\u2191",
	behind: "\u2193",
	diverged: "\u21D5",
	conflicted: "=",
	untracked: "?",
	stashed: "$",
	modified: "!",
	staged: "+",
	renamed: "\u00BB",
	deleted: "\u2718",
	typechanged: "~",
	cacheHit: "\uF086",
	editorPrompt: "\u276F",
	rail: "\u2502",
	username: "\uF2BD",
	time: "\uF017",
	os: "\uF31A",
	package: "\uF8D6",
}));

vi.mock("./icons", () => ({
	ICON_GLYPH_KEYS: MOCK_ICON_GLYPH_KEYS,
	NERD_DEFAULT_ICONS: MOCK_NERD_DEFAULT_ICONS,
	normalizeIconMode: (v: unknown) => {
		if (v === "nerd" || v === "ascii") return v;
		return "auto";
	},
	resolveConfiguredIcons: (mode: string, overrides: Record<string, unknown> = {}) => ({
		mode,
		...MOCK_NERD_DEFAULT_ICONS,
		...overrides,
	}),
}));

vi.mock("./style", () => ({
	isSupportedColorSpec: (s: string) => {
		// Accept any string (including empty) as a "valid" color spec for tests.
		return typeof s === "string";
	},
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => "/mock/agent/dir",
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	mergeConfig,
	defaultConfig,
	isSeparatorStyle,
	FOOTER_FORMAT_VARIABLES,
	FOOTER_FORMAT_ALIASES,
	getExtensionStatusPlacement,
	getExtensionStatusColorMode,
} from "./config";

import type {
	PolishedTuiConfig,
	ContextStyle,
	SeparatorStyle,
	ModelLabelSource,
} from "./config";

// ===========================================================================
// mergeConfig
// ===========================================================================

describe("mergeConfig", () => {
	it("returns default config when given an empty object", () => {
		const result = mergeConfig({});
		expect(result).toEqual(defaultConfig);
	});

	it("returns default config when given null / non-object values", () => {
		for (const input of [null, undefined, 42, "string", [], true]) {
			const result = mergeConfig(input);
			expect(result).toEqual(defaultConfig);
		}
	});

	it("applies partial overrides for top-level scalar fields", () => {
		const result = mergeConfig({
			footerFormat: "$cwd $sep $git_branch",
			separator: "dot",
			contextStyle: "gauge",
			editorModelLabel: "name",
		});
		expect(result.footerFormat).toBe("$cwd $sep $git_branch");
		expect(result.separator).toBe("dot");
		expect(result.contextStyle).toBe("gauge");
		expect(result.editorModelLabel).toBe("name");
	});

	it("ignores unknown top-level keys", () => {
		const result = mergeConfig({ bogusKey: "should-be-ignored", foo: 123 });
		// Should not throw and should return defaults
		expect(result).toEqual(defaultConfig);
	});

	it("handles deeply nested partial overrides (pathDisplay)", () => {
		const result = mergeConfig({
			pathDisplay: { mode: "full", depth: 3 },
		});
		expect(result.pathDisplay).toEqual({ mode: "full", depth: 3 });
	});

	it("handles deeply nested partial overrides (gitBranch)", () => {
		const result = mergeConfig({ gitBranch: { maxLength: 20 } });
		expect(result.gitBranch).toEqual({ maxLength: 20 });
	});

	it("handles deeply nested partial overrides (gitCommit)", () => {
		const result = mergeConfig({
			gitCommit: { hashLength: 10, onlyDetached: false, showTag: false },
		});
		expect(result.gitCommit).toEqual({
			hashLength: 10,
			onlyDetached: false,
			showTag: false,
		});
	});

	it("handles deeply nested partial overrides (gitMetrics)", () => {
		const result = mergeConfig({
			gitMetrics: { onlyNonzero: false, ignoreSubmodules: true },
		});
		expect(result.gitMetrics).toEqual({
			onlyNonzero: false,
			ignoreSubmodules: true,
		});
	});

	it("preserves defaults for unset nested keys", () => {
		const result = mergeConfig({ pathDisplay: { mode: "full" } });
		expect(result.pathDisplay.mode).toBe("full");
		expect(result.pathDisplay.depth).toBe(defaultConfig.pathDisplay.depth);
	});

	it("uses default values when colorSources is not a record", () => {
		const result = mergeConfig({ colorSources: "bad" });
		expect(result.colorSources).toEqual(defaultConfig.colorSources);
	});

	it("uses default values when features is not a record", () => {
		const result = mergeConfig({ features: null });
		expect(result.features).toEqual(defaultConfig.features);
	});

	it("uses default values when footerSegments is not a record", () => {
		const result = mergeConfig({ footerSegments: [] });
		expect(result.footerSegments).toEqual(defaultConfig.footerSegments);
	});

	it("empty editorMetadataFormat falls back to default", () => {
		const result = mergeConfig({ editorMetadataFormat: "" });
		expect(result.editorMetadataFormat).toBe(defaultConfig.editorMetadataFormat);
	});

	it("empty footerFormat falls back to default (empty string)", () => {
		const result = mergeConfig({ footerFormat: "" });
		expect(result.footerFormat).toBe("");
	});
});

// ===========================================================================
// Color parsing (via mergeConfig)
// ===========================================================================

describe("color parsing via mergeConfig", () => {
	it("applies valid color overrides", () => {
		const result = mergeConfig({
			colors: {
				cwd: "blue",
				gitBranch: "italic green",
				cost: "red",
			},
		});
		expect(result.colors.cwd).toBe("blue");
		expect(result.colors.gitBranch).toBe("italic green");
		expect(result.colors.cost).toBe("red");
	});

	it("keeps defaults for unset color keys", () => {
		const result = mergeConfig({ colors: { cwd: "blue" } });
		expect(result.colors.cwd).toBe("blue");
	});

	it("ignores colors not in the record (non-object)", () => {
		const result = mergeConfig({ colors: 42 });
		expect(result.colors).toEqual(defaultConfig.colors);
	});

	it("falls back to cwdText alias for cwd color", () => {
		const result = mergeConfig({ colors: { cwdText: "bright-blue" } });
		expect(result.colors.cwd).toBe("bright-blue");
	});

	it("falls back to git alias for gitBranch color", () => {
		const result = mergeConfig({ colors: { git: "bold white" } });
		expect(result.colors.gitBranch).toBe("bold white");
	});

	it("prefers cwd over cwdText when both present", () => {
		const result = mergeConfig({ colors: { cwd: "red", cwdText: "blue" } });
		expect(result.colors.cwd).toBe("red");
	});

	it("prefers gitBranch over git when both present", () => {
		const result = mergeConfig({ colors: { gitBranch: "yellow", git: "purple" } });
		expect(result.colors.gitBranch).toBe("yellow");
	});

	// Since isSupportedColorSpec is mocked to always return true, we can't
	// test "invalid color → default". Instead we verify the fallback chain.
	it("non-string color values are ignored", () => {
		const result = mergeConfig({ colors: { cwd: 123 as unknown as string } });
		expect(result.colors.cwd).toBe(defaultConfig.colors.cwd);
	});
});

// ===========================================================================
// parseContextStyle (via mergeConfig)
// ===========================================================================

describe("parseContextStyle via mergeConfig", () => {
	it("accepts 'text'", () => {
		expect(mergeConfig({ contextStyle: "text" }).contextStyle).toBe("text");
	});

	it("accepts 'gauge'", () => {
		expect(mergeConfig({ contextStyle: "gauge" }).contextStyle).toBe("gauge");
	});

	it("accepts 'text+gauge'", () => {
		expect(mergeConfig({ contextStyle: "text+gauge" }).contextStyle).toBe("text+gauge");
	});

	it("falls back to default for invalid values", () => {
		expect(mergeConfig({ contextStyle: "invalid" }).contextStyle).toBe(
			defaultConfig.contextStyle,
		);
		expect(mergeConfig({ contextStyle: 123 }).contextStyle).toBe(
			defaultConfig.contextStyle,
		);
	});
});

// ===========================================================================
// parseProjectRefreshIntervalMs (via mergeConfig)
// ===========================================================================

describe("parseProjectRefreshIntervalMs via mergeConfig", () => {
	const DEFAULT = defaultConfig.projectRefreshIntervalMs;
	const MIN = 5000;

	it("returns default for non-numbers", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: "abc" }).projectRefreshIntervalMs).toBe(
			DEFAULT,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: null }).projectRefreshIntervalMs).toBe(
			DEFAULT,
		);
	});

	it("returns default for NaN / Infinity", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: NaN }).projectRefreshIntervalMs).toBe(
			DEFAULT,
		);
		expect(
			mergeConfig({ projectRefreshIntervalMs: Infinity }).projectRefreshIntervalMs,
		).toBe(DEFAULT);
	});

	it("returns 0 for exactly 0", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 0 }).projectRefreshIntervalMs).toBe(0);
	});

	it("returns 0 for negative numbers", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: -1 }).projectRefreshIntervalMs).toBe(0);
		expect(mergeConfig({ projectRefreshIntervalMs: -1000 }).projectRefreshIntervalMs).toBe(0);
	});

	it("returns MIN (5000) for small positive numbers", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 1 }).projectRefreshIntervalMs).toBe(MIN);
		expect(mergeConfig({ projectRefreshIntervalMs: 1000 }).projectRefreshIntervalMs).toBe(
			MIN,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: 4999 }).projectRefreshIntervalMs).toBe(
			MIN,
		);
	});

	it("returns rounded value for numbers >= MIN", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 5000 }).projectRefreshIntervalMs).toBe(
			5000,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: 10000 }).projectRefreshIntervalMs).toBe(
			10000,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: 60000 }).projectRefreshIntervalMs).toBe(
			60000,
		);
	});

	it("rounds to nearest integer", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 7499.6 }).projectRefreshIntervalMs).toBe(7500);
		expect(mergeConfig({ projectRefreshIntervalMs: 10000.4 }).projectRefreshIntervalMs).toBe(
			10000,
		);
	});
});

// ===========================================================================
// parseContextThresholds (via mergeConfig)
// ===========================================================================

describe("parseContextThresholds via mergeConfig", () => {
	it("returns defaults when not a record", () => {
		expect(mergeConfig({ contextThresholds: null }).contextThresholds).toEqual(
			defaultConfig.contextThresholds,
		);
		expect(mergeConfig({ contextThresholds: 42 }).contextThresholds).toEqual(
			defaultConfig.contextThresholds,
		);
	});

	it("clamps valid numbers to 0-100", () => {
		const result = mergeConfig({
			contextThresholds: { warning: -10, error: 150 },
		});
		expect(result.contextThresholds.warning).toBe(0);
		expect(result.contextThresholds.error).toBe(100);
	});

	it("uses defaults for non-number fields", () => {
		const result = mergeConfig({
			contextThresholds: { warning: "bad", error: null },
		});
		expect(result.contextThresholds).toEqual(defaultConfig.contextThresholds);
	});

	it("swaps error < warning so error >= warning always", () => {
		const result = mergeConfig({
			contextThresholds: { warning: 80, error: 50 },
		});
		expect(result.contextThresholds.warning).toBe(50);
		expect(result.contextThresholds.error).toBe(80);
	});

	it("preserves order when warning < error", () => {
		const result = mergeConfig({
			contextThresholds: { warning: 30, error: 70 },
		});
		expect(result.contextThresholds.warning).toBe(30);
		expect(result.contextThresholds.error).toBe(70);
	});

	it("equal values stay equal", () => {
		const result = mergeConfig({
			contextThresholds: { warning: 50, error: 50 },
		});
		expect(result.contextThresholds.warning).toBe(50);
		expect(result.contextThresholds.error).toBe(50);
	});

	it("rounds values", () => {
		const result = mergeConfig({
			contextThresholds: { warning: 30.7, error: 70.2 },
		});
		expect(result.contextThresholds.warning).toBe(31);
		expect(result.contextThresholds.error).toBe(70);
	});
});

// ===========================================================================
// parsePathDisplay (via mergeConfig)
// ===========================================================================

describe("parsePathDisplay via mergeConfig", () => {
	it("returns defaults when not a record", () => {
		expect(mergeConfig({ pathDisplay: null }).pathDisplay).toEqual(
			defaultConfig.pathDisplay,
		);
	});

	it("accepts 'basename' mode", () => {
		expect(mergeConfig({ pathDisplay: { mode: "basename" } }).pathDisplay.mode).toBe(
			"basename",
		);
	});

	it("accepts 'full' mode", () => {
		expect(mergeConfig({ pathDisplay: { mode: "full" } }).pathDisplay.mode).toBe("full");
	});

	it("rejects invalid mode → default", () => {
		expect(
			mergeConfig({ pathDisplay: { mode: "short" } }).pathDisplay.mode,
		).toBe(defaultConfig.pathDisplay.mode);
	});

	it("clamps depth to 0-5", () => {
		expect(mergeConfig({ pathDisplay: { depth: -1 } }).pathDisplay.depth).toBe(0);
		expect(mergeConfig({ pathDisplay: { depth: 0 } }).pathDisplay.depth).toBe(0);
		expect(mergeConfig({ pathDisplay: { depth: 3 } }).pathDisplay.depth).toBe(3);
		expect(mergeConfig({ pathDisplay: { depth: 5 } }).pathDisplay.depth).toBe(5);
		expect(mergeConfig({ pathDisplay: { depth: 10 } }).pathDisplay.depth).toBe(5);
	});

	it("floors non-integer depth values", () => {
		expect(mergeConfig({ pathDisplay: { depth: 3.9 } }).pathDisplay.depth).toBe(3);
	});

	it("non-number depth → default", () => {
		expect(mergeConfig({ pathDisplay: { depth: "deep" } }).pathDisplay.depth).toBe(
			defaultConfig.pathDisplay.depth,
		);
	});
});

// ===========================================================================
// isSeparatorStyle
// ===========================================================================

describe("isSeparatorStyle", () => {
	it("returns true for valid styles", () => {
		expect(isSeparatorStyle("pipe")).toBe(true);
		expect(isSeparatorStyle("dot")).toBe(true);
		expect(isSeparatorStyle("chevron")).toBe(true);
		expect(isSeparatorStyle("none")).toBe(true);
	});

	it("returns false for invalid values", () => {
		expect(isSeparatorStyle("dash")).toBe(false);
		expect(isSeparatorStyle("")).toBe(false);
		expect(isSeparatorStyle(42)).toBe(false);
		expect(isSeparatorStyle(null)).toBe(false);
		expect(isSeparatorStyle(undefined)).toBe(false);
	});

	it("parseSeparatorStyle (via mergeConfig) uses guard", () => {
		expect(mergeConfig({ separator: "dot" }).separator).toBe("dot");
		expect(mergeConfig({ separator: "invalid" }).separator).toBe(defaultConfig.separator);
	});
});

// ===========================================================================
// normalizeColorSources (via mergeConfig)
// ===========================================================================

describe("normalizeColorSources via mergeConfig", () => {
	it("accepts valid source values", () => {
		const result = mergeConfig({
			colorSources: { starship: "terminal", editor: "theme", userMessages: "terminal" },
		});
		expect(result.colorSources.starship).toBe("terminal");
		expect(result.colorSources.editor).toBe("theme");
		expect(result.colorSources.userMessages).toBe("terminal");
	});

	it("falls back to defaults for invalid values", () => {
		const result = mergeConfig({
			colorSources: {
				starship: "bogus" as unknown,
				editor: 123,
				userMessages: null,
			},
		});
		expect(result.colorSources.starship).toBe(defaultConfig.colorSources.starship);
		expect(result.colorSources.editor).toBe(defaultConfig.colorSources.editor);
		expect(result.colorSources.userMessages).toBe(defaultConfig.colorSources.userMessages);
	});

	it("partial override preserves defaults for unset keys", () => {
		const result = mergeConfig({
			colorSources: { starship: "terminal" },
		});
		expect(result.colorSources.starship).toBe("terminal");
		expect(result.colorSources.editor).toBe(defaultConfig.colorSources.editor);
		expect(result.colorSources.userMessages).toBe(defaultConfig.colorSources.userMessages);
	});
});

// ===========================================================================
// normalizeFooterSegments (via mergeConfig)
// ===========================================================================

describe("normalizeFooterSegments via mergeConfig", () => {
	it("accepts boolean overrides", () => {
		const result = mergeConfig({
			footerSegments: {
				cwd: false,
				gitBranch: false,
				tokens: false,
				sessionDuration: true,
			},
		});
		expect(result.footerSegments.cwd).toBe(false);
		expect(result.footerSegments.gitBranch).toBe(false);
		expect(result.footerSegments.tokens).toBe(false);
		expect(result.footerSegments.sessionDuration).toBe(true);
	});

	it("non-boolean values fall back to default", () => {
		const result = mergeConfig({
			footerSegments: {
				cwd: "true" as unknown as boolean,
				gitBranch: 1 as unknown as boolean,
			},
		});
		expect(result.footerSegments.cwd).toBe(defaultConfig.footerSegments.cwd);
		expect(result.footerSegments.gitBranch).toBe(defaultConfig.footerSegments.gitBranch);
	});

	it("partial override preserves defaults for unset keys", () => {
		const result = mergeConfig({
			footerSegments: { cost: false },
		});
		expect(result.footerSegments.cost).toBe(false);
		expect(result.footerSegments.cwd).toBe(defaultConfig.footerSegments.cwd);
	});

	it("non-record → all defaults", () => {
		expect(mergeConfig({ footerSegments: "bad" }).footerSegments).toEqual(
			defaultConfig.footerSegments,
		);
	});
});

// ===========================================================================
// FOOTER_FORMAT_VARIABLES
// ===========================================================================

describe("FOOTER_FORMAT_VARIABLES", () => {
	it("contains expected variable names", () => {
		const vars = FOOTER_FORMAT_VARIABLES as readonly string[];
		expect(vars).toContain("cwd");
		expect(vars).toContain("git_branch");
		expect(vars).toContain("git_status");
		expect(vars).toContain("git_state");
		expect(vars).toContain("runtime");
		expect(vars).toContain("session_duration");
		expect(vars).toContain("username");
		expect(vars).toContain("os");
		expect(vars).toContain("time");
		expect(vars).toContain("context");
		expect(vars).toContain("tokens");
		expect(vars).toContain("cost");
		expect(vars).toContain("package");
		expect(vars).toContain("package_version");
		expect(vars).toContain("git_commit");
		expect(vars).toContain("git_tag");
		expect(vars).toContain("git_metrics");
		expect(vars).toContain("git_added");
		expect(vars).toContain("git_deleted");
		expect(vars).toContain("sep");
	});

	it("has exactly 20 entries", () => {
		expect((FOOTER_FORMAT_VARIABLES as readonly string[]).length).toBe(20);
	});
});

// ===========================================================================
// FOOTER_FORMAT_ALIASES
// ===========================================================================

describe("FOOTER_FORMAT_ALIASES", () => {
	it("maps aliases to canonical names", () => {
		expect(FOOTER_FORMAT_ALIASES.directory).toBe("cwd");
		expect(FOOTER_FORMAT_ALIASES.branch).toBe("git_branch");
		expect(FOOTER_FORMAT_ALIASES.status).toBe("git_status");
		expect(FOOTER_FORMAT_ALIASES.state).toBe("git_state");
		expect(FOOTER_FORMAT_ALIASES.commit).toBe("git_commit");
		expect(FOOTER_FORMAT_ALIASES.tag).toBe("git_tag");
		expect(FOOTER_FORMAT_ALIASES.duration).toBe("session_duration");
		expect(FOOTER_FORMAT_ALIASES.separator).toBe("sep");
	});
});

// ===========================================================================
// getExtensionStatusPlacement
// ===========================================================================

describe("getExtensionStatusPlacement", () => {
	const config = mergeConfig({
		extensionStatuses: {
			defaultPlacement: "left",
			placements: { myExt: "right", otherExt: "off" },
		},
	});

	it("returns explicit placement when set", () => {
		expect(getExtensionStatusPlacement(config, "myExt")).toBe("right");
		expect(getExtensionStatusPlacement(config, "otherExt")).toBe("off");
	});

	it("falls back to defaultPlacement for unknown keys", () => {
		expect(getExtensionStatusPlacement(config, "unknown")).toBe("left");
	});

	it("uses default from defaultConfig when no explicit defaultPlacement", () => {
		const result = getExtensionStatusPlacement(defaultConfig, "anything");
		expect(result).toBe(defaultConfig.extensionStatuses.defaultPlacement);
	});
});

// ===========================================================================
// getExtensionStatusColorMode
// ===========================================================================

describe("getExtensionStatusColorMode", () => {
	const config = mergeConfig({
		extensionStatuses: {
			colorModes: { myExt: "original" },
		},
	});

	it("returns explicit color mode when set", () => {
		expect(getExtensionStatusColorMode(config, "myExt")).toBe("original");
	});

	it("returns 'zentui' as the default for unknown keys", () => {
		expect(getExtensionStatusColorMode(config, "unknown")).toBe("zentui");
	});

	it("returns 'zentui' when no colorModes configured at all", () => {
		expect(getExtensionStatusColorMode(defaultConfig, "anything")).toBe("zentui");
	});
});

// ===========================================================================
// defaultConfig
// ===========================================================================

describe("defaultConfig", () => {
	it("has all top-level keys", () => {
		const keys = Object.keys(defaultConfig).sort();
		expect(keys).toEqual(
			[
				"projectRefreshIntervalMs",
				"footerFormat",
				"editorMetadataFormat",
				"separator",
				"contextStyle",
				"editorModelLabel",
				"contextThresholds",
				"pathDisplay",
				"gitBranch",
				"icons",
				"colors",
				"colorSources",
				"features",
				"footerSegments",
				"gitCommit",
				"gitMetrics",
				"extensionStatuses",
				"fixedEditor",
			].sort(),
		);
	});

	it("has expected default color values", () => {
		expect(defaultConfig.colors.cwd).toBe("bold cyan");
		expect(defaultConfig.colors.gitBranch).toBe("bold purple");
		expect(defaultConfig.colors.gitStatus).toBe("bold red");
		expect(defaultConfig.colors.contextNormal).toBe("bright-black");
		expect(defaultConfig.colors.contextWarning).toBe("bold yellow");
		expect(defaultConfig.colors.contextError).toBe("bold red");
		expect(defaultConfig.colors.tokens).toBe("bright-black");
		expect(defaultConfig.colors.cost).toBe("bold green");
		expect(defaultConfig.colors.separator).toBe("bright-black");
		expect(defaultConfig.colors.runtimePrefix).toBe("");
		expect(defaultConfig.colors.extensionStatus).toBe("bright-black");
		expect(defaultConfig.colors.sessionDuration).toBe("yellow");
		expect(defaultConfig.colors.packageVersion).toBe("208");
		expect(defaultConfig.colors.gitCommit).toBe("bold green");
		expect(defaultConfig.colors.gitMetricsAdded).toBe("bold green");
		expect(defaultConfig.colors.gitMetricsDeleted).toBe("bold red");
		expect(defaultConfig.colors.username).toBe("bold yellow");
		expect(defaultConfig.colors.time).toBe("bold yellow");
		expect(defaultConfig.colors.os).toBe("bold white");
	});

	it("has expected contextThresholds", () => {
		expect(defaultConfig.contextThresholds).toEqual({ warning: 70, error: 90 });
	});

	it("has expected pathDisplay", () => {
		expect(defaultConfig.pathDisplay).toEqual({ mode: "basename", depth: 0 });
	});

	it("has expected gitBranch", () => {
		expect(defaultConfig.gitBranch).toEqual({ maxLength: "full" });
	});

	it("has expected gitCommit defaults", () => {
		expect(defaultConfig.gitCommit).toEqual({
			hashLength: 7,
			onlyDetached: true,
			showTag: true,
		});
	});

	it("has expected gitMetrics defaults", () => {
		expect(defaultConfig.gitMetrics).toEqual({
			onlyNonzero: true,
			ignoreSubmodules: false,
		});
	});

	it("has expected extensionStatuses defaults", () => {
		expect(defaultConfig.extensionStatuses.defaultPlacement).toBe("right");
		expect(defaultConfig.extensionStatuses.placements).toEqual({});
		expect(defaultConfig.extensionStatuses.colorModes).toEqual({});
	});

	it("has expected fixedEditor defaults", () => {
		expect(defaultConfig.fixedEditor).toEqual({
			enabled: false,
			mouseScroll: true,
			copyNotice: true,
		});
	});

	it("has separated reference identity (immutability guard)", () => {
		// mergeConfig must return new object references
		const a = mergeConfig({});
		const b = mergeConfig({});
		expect(a).not.toBe(b);
		expect(a.colors).not.toBe(b.colors);
		expect(a.contextThresholds).not.toBe(b.contextThresholds);
		expect(a.pathDisplay).not.toBe(b.pathDisplay);
		expect(a.colorSources).not.toBe(b.colorSources);
		expect(a.features).not.toBe(b.features);
		expect(a.footerSegments).not.toBe(b.footerSegments);
		expect(a.extensionStatuses).not.toBe(b.extensionStatuses);
		expect(a.gitCommit).toEqual(b.gitCommit);
		expect(a.gitMetrics).toEqual(b.gitMetrics);
	});
});

// ===========================================================================
// normalizeGitCommitConfig (via mergeConfig)
// ===========================================================================

describe("normalizeGitCommitConfig via mergeConfig", () => {
	const defaults = defaultConfig.gitCommit;

	it("clamps hashLength to [4, 40]", () => {
		expect(mergeConfig({ gitCommit: { hashLength: 0 } }).gitCommit.hashLength).toBe(4);
		expect(mergeConfig({ gitCommit: { hashLength: 1 } }).gitCommit.hashLength).toBe(4);
		expect(mergeConfig({ gitCommit: { hashLength: 4 } }).gitCommit.hashLength).toBe(4);
		expect(mergeConfig({ gitCommit: { hashLength: 20 } }).gitCommit.hashLength).toBe(20);
		expect(mergeConfig({ gitCommit: { hashLength: 40 } }).gitCommit.hashLength).toBe(40);
		expect(mergeConfig({ gitCommit: { hashLength: 100 } }).gitCommit.hashLength).toBe(40);
	});

	it("rounds hashLength", () => {
		expect(mergeConfig({ gitCommit: { hashLength: 6.7 } }).gitCommit.hashLength).toBe(7);
		expect(mergeConfig({ gitCommit: { hashLength: 3.4 } }).gitCommit.hashLength).toBe(4);
	});

	it("non-number hashLength → default", () => {
		expect(
			mergeConfig({ gitCommit: { hashLength: "abc" as unknown } }).gitCommit.hashLength,
		).toBe(defaults.hashLength);
		expect(
			mergeConfig({ gitCommit: { hashLength: NaN } }).gitCommit.hashLength,
		).toBe(defaults.hashLength);
	});

	it("boolean fields fall back to defaults for non-booleans", () => {
		const result = mergeConfig({
			gitCommit: {
				onlyDetached: "true" as unknown,
				showTag: 1 as unknown,
			},
		});
		expect(result.gitCommit.onlyDetached).toBe(defaults.onlyDetached);
		expect(result.gitCommit.showTag).toBe(defaults.showTag);
	});

	it("boolean fields override when valid", () => {
		const result = mergeConfig({
			gitCommit: { onlyDetached: false, showTag: false },
		});
		expect(result.gitCommit.onlyDetached).toBe(false);
		expect(result.gitCommit.showTag).toBe(false);
	});

	it("non-record gitCommit → defaults", () => {
		expect(mergeConfig({ gitCommit: null }).gitCommit).toEqual(defaults);
	});
});

// ===========================================================================
// normalizeGitMetricsConfig (via mergeConfig)
// ===========================================================================

describe("normalizeGitMetricsConfig via mergeConfig", () => {
	const defaults = defaultConfig.gitMetrics;

	it("accepts boolean overrides", () => {
		const result = mergeConfig({
			gitMetrics: { onlyNonzero: false, ignoreSubmodules: true },
		});
		expect(result.gitMetrics.onlyNonzero).toBe(false);
		expect(result.gitMetrics.ignoreSubmodules).toBe(true);
	});

	it("non-boolean values fall back to defaults", () => {
		const result = mergeConfig({
			gitMetrics: {
				onlyNonzero: "yes" as unknown,
				ignoreSubmodules: 1 as unknown,
			},
		});
		expect(result.gitMetrics.onlyNonzero).toBe(defaults.onlyNonzero);
		expect(result.gitMetrics.ignoreSubmodules).toBe(defaults.ignoreSubmodules);
	});

	it("non-record gitMetrics → defaults", () => {
		expect(mergeConfig({ gitMetrics: "bad" }).gitMetrics).toEqual(defaults);
	});
});
