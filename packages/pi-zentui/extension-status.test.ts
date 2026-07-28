import { describe, it, expect } from "vitest";
import {
  sanitizeExtensionStatusText,
  sanitizeExtensionStatusOriginalText,
  collectExtensionStatusSegments,
} from "./extension-status";
import type {
  PolishedTuiConfig,
  ExtensionStatusPlacement,
  ExtensionStatusColorMode,
} from "./config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: {
  defaultPlacement?: ExtensionStatusPlacement;
  placements?: Record<string, ExtensionStatusPlacement>;
  colorModes?: Record<string, ExtensionStatusColorMode>;
} = {}): PolishedTuiConfig {
  return {
    projectRefreshIntervalMs: 30_000,
    footerFormat: "",
    editorMetadataFormat: "",
    separator: "pipe",
    contextStyle: "text",
    editorModelLabel: "id",
    contextThresholds: { warning: 50, error: 80 },
    pathDisplay: { mode: "basename", depth: 0 },
    gitBranch: { maxLength: "full" },
    icons: {
      mode: "auto",
      cwd: "",
      git: "",
      ahead: "",
      behind: "",
      diverged: "",
      conflicted: "",
      untracked: "",
      stashed: "",
      modified: "",
      staged: "",
      renamed: "",
      deleted: "",
      typechanged: "",
      cacheHit: "",
      editorPrompt: "",
      rail: "",
      username: "",
      time: "",
      os: "",
      package: "",
    },
    colors: {
      cwd: "",
      gitBranch: "",
      gitStatus: "",
      contextNormal: "",
      contextWarning: "",
      contextError: "",
      tokens: "",
      cost: "",
      separator: "",
      runtimePrefix: "",
      extensionStatus: "",
      sessionDuration: "",
      packageVersion: "",
      gitCommit: "",
      gitMetricsAdded: "",
      gitMetricsDeleted: "",
      username: "",
      time: "",
      os: "",
    },
    colorSources: { starship: "terminal", editor: "terminal", userMessages: "terminal" },
    features: { fileWatcher: false },
    footerSegments: { left: [], middle: [], right: [] },
    gitCommit: { hashLength: 7, onlyDetached: false, showTag: false },
    gitMetrics: { onlyNonzero: true, ignoreSubmodules: false },
    extensionStatuses: {
      defaultPlacement: overrides.defaultPlacement ?? "right",
      placements: overrides.placements ?? {},
      colorModes: overrides.colorModes ?? {},
    },
    fixedEditor: {},
  } as PolishedTuiConfig;
}

// ---------------------------------------------------------------------------
// sanitizeExtensionStatusText
// ---------------------------------------------------------------------------
describe("sanitizeExtensionStatusText", () => {
  it("strips VT control characters", () => {
    const result = sanitizeExtensionStatusText("\x1b[5;31mHello\x1b[0m\x07World");
    expect(result).toBe("HelloWorld");
  });

  it("normalizes whitespace (tabs, newlines, etc.)", () => {
    const result = sanitizeExtensionStatusText("Hello\tWorld\nFoo\rBar\fBaz\vQux");
    expect(result).toBe("Hello World Foo Bar Baz Qux");
  });

  it("collapses multiple spaces into one", () => {
    const result = sanitizeExtensionStatusText("Hello    World");
    expect(result).toBe("Hello World");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeExtensionStatusText("  Hello  ")).toBe("Hello");
  });

  it("returns empty string for only-whitespace input", () => {
    expect(sanitizeExtensionStatusText("   ")).toBe("");
  });

  it("returns empty string for only-control-characters input", () => {
    expect(sanitizeExtensionStatusText("\x1b[0m\x07\x00")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeExtensionStatusText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// sanitizeExtensionStatusOriginalText
// ---------------------------------------------------------------------------
describe("sanitizeExtensionStatusOriginalText", () => {
  it("preserves safe SGR sequences", () => {
    const result = sanitizeExtensionStatusOriginalText("\x1b[31mRed\x1b[0m");
    expect(result).toBe("\x1b[31mRed\x1b[0m");
  });

  it("strips unsafe VT control characters but keeps SGR", () => {
    const result = sanitizeExtensionStatusOriginalText("\x1b[5;31mBlinking Red\x1b[0m\x07Bell");
    // \x07 is unsafe and should be stripped
    expect(result).toBe("\x1b[5;31mBlinking Red\x1b[0mBell");
  });

  it("handles multiple SGR codes interspersed with text", () => {
    const result = sanitizeExtensionStatusOriginalText(
      "\x1b[31mRed\x1b[0m then \x1b[32mGreen\x1b[0m",
    );
    expect(result).toBe("\x1b[31mRed\x1b[0m then \x1b[32mGreen\x1b[0m");
  });

  it("strips bare escape without proper SGR format", () => {
    const result = sanitizeExtensionStatusOriginalText("\x1bXBad\x1b[31mGood\x1b[0m");
    // \x1bX is not a valid SGR sequence, should be stripped entirely
    // The \x1b is stripped by stripVTControlCharacters, X stays
    expect(result).toContain("\x1b[31mGood\x1b[0m");
  });

  it("normalizes whitespace while preserving SGR", () => {
    const result = sanitizeExtensionStatusOriginalText("\x1b[31mHello\tWorld\x1b[0m\nFoo");
    expect(result).toBe("\x1b[31mHello World\x1b[0m Foo");
  });

  it("returns empty string when only SGR codes and whitespace remain", () => {
    const result = sanitizeExtensionStatusOriginalText("\x1b[31m\x1b[0m   ");
    expect(result).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeExtensionStatusOriginalText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// collectExtensionStatusSegments
// ---------------------------------------------------------------------------
describe("collectExtensionStatusSegments", () => {
  it("returns empty segments for an empty map", () => {
    const config = makeConfig();
    const result = collectExtensionStatusSegments(new Map(), config);
    expect(result).toEqual({ left: [], middle: [], right: [] });
  });

  it("groups segments by placement (left/middle/right)", () => {
    const config = makeConfig({
      placements: {
        a: "left",
        b: "middle",
        c: "right",
      },
    });

    const statuses = new Map([
      ["a", "LeftItem"],
      ["b", "MidItem"],
      ["c", "RightItem"],
    ]);

    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.left).toEqual([
      { key: "a", text: "LeftItem", placement: "left", colorMode: "zentui" },
    ]);
    expect(result.middle).toEqual([
      { key: "b", text: "MidItem", placement: "middle", colorMode: "zentui" },
    ]);
    expect(result.right).toEqual([
      { key: "c", text: "RightItem", placement: "right", colorMode: "zentui" },
    ]);
  });

  it("respects 'off' placement — drops the segment", () => {
    const config = makeConfig({
      placements: { hidden: "off" },
    });
    const statuses = new Map([["hidden", "ShouldNotAppear"]]);
    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.left).toEqual([]);
    expect(result.middle).toEqual([]);
    expect(result.right).toEqual([]);
  });

  it("respects defaultPlacement for keys without explicit placement", () => {
    const config = makeConfig({ defaultPlacement: "left" });
    const statuses = new Map([["key1", "Value1"]]);
    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.left).toEqual([
      { key: "key1", text: "Value1", placement: "left", colorMode: "zentui" },
    ]);
    expect(result.middle).toEqual([]);
    expect(result.right).toEqual([]);
  });

  it("sorts segments by key within each placement group", () => {
    const config = makeConfig({
      placements: { z: "left", a: "left", m: "left" },
    });
    const statuses = new Map([
      ["z", "Zebra"],
      ["a", "Alpha"],
      ["m", "Mike"],
    ]);
    const result = collectExtensionStatusSegments(statuses, config);
    const keys = result.left.map((s) => s.key);
    expect(keys).toEqual(["a", "m", "z"]);
  });

  it("respects colorMode — 'zentui' uses sanitizeExtensionStatusText", () => {
    const config = makeConfig({
      colorModes: { noisy: "zentui" },
    });
    const statuses = new Map([["noisy", "\x1b[31mRed\x1b[0m\x07Bell"]]);
    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.right[0].text).toBe("RedBell");
    expect(result.right[0].colorMode).toBe("zentui");
  });

  it("respects colorMode — 'original' preserves SGR via sanitizeExtensionStatusOriginalText", () => {
    const config = makeConfig({
      colorModes: { styled: "original" },
    });
    const statuses = new Map([["styled", "\x1b[31mRed\x1b[0m\x07Bell"]]);
    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.right[0].text).toBe("\x1b[31mRed\x1b[0mBell");
    expect(result.right[0].colorMode).toBe("original");
  });

  it("drops keys with no visible text after sanitization", () => {
    const config = makeConfig();
    const statuses = new Map([["empty", "\x1b[0m  "]]);
    const result = collectExtensionStatusSegments(statuses, config);
    expect(result.right).toEqual([]);
  });

  it("handles a mix of placements, color modes, and dropped keys", () => {
    const config = makeConfig({
      defaultPlacement: "right",
      placements: {
        lefty: "left",
        offy: "off",
        middy: "middle",
      },
      colorModes: {
        lefty: "original",
        middy: "zentui",
      },
    });

    const statuses = new Map([
      ["lefty", "\x1b[32mGreen\x1b[0m"],
      ["offy", "Hidden"],
      ["middy", "\x1b[33m\x07Yellow\x1b[0m"],
      ["righty", "DefaultRight"],
      ["empty", "  "],
    ]);

    const result = collectExtensionStatusSegments(statuses, config);

    expect(result.left).toEqual([
      {
        key: "lefty",
        text: "\x1b[32mGreen\x1b[0m",
        placement: "left",
        colorMode: "original",
      },
    ]);

    expect(result.middle).toEqual([
      {
        key: "middy",
        text: "Yellow",
        placement: "middle",
        colorMode: "zentui",
      },
    ]);

    expect(result.right).toEqual([
      {
        key: "righty",
        text: "DefaultRight",
        placement: "right",
        colorMode: "zentui",
      },
    ]);

    // "offy" and "empty" should be absent
  });
});
