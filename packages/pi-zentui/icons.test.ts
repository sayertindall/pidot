import { describe, it, expect } from "vitest";
import {
  normalizeIconMode,
  resolveConfiguredIcons,
  resolveRuntimeSymbol,
  resolveOsIcon,
  resolvePackageIcon,
  NERD_DEFAULT_ICONS,
  ASCII_DEFAULT_ICONS,
  ICON_GLYPH_KEYS,
  type IconGlyphs,
  type IconMode,
} from "./icons";

// ---------------------------------------------------------------------------
// normalizeIconMode
// ---------------------------------------------------------------------------
describe("normalizeIconMode", () => {
  it('returns "auto" for "auto"', () => {
    expect(normalizeIconMode("auto")).toBe("auto");
  });

  it('returns "nerd" for "nerd"', () => {
    expect(normalizeIconMode("nerd")).toBe("nerd");
  });

  it('returns "ascii" for "ascii"', () => {
    expect(normalizeIconMode("ascii")).toBe("ascii");
  });

  it('returns "auto" for undefined', () => {
    expect(normalizeIconMode(undefined)).toBe("auto");
  });

  it('returns "auto" for invalid values', () => {
    expect(normalizeIconMode("invalid")).toBe("auto");
    expect(normalizeIconMode(123)).toBe("auto");
    expect(normalizeIconMode(null)).toBe("auto");
    expect(normalizeIconMode({})).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// resolveConfiguredIcons
// ---------------------------------------------------------------------------
describe("resolveConfiguredIcons", () => {
  it("returns Nerd Font glyphs for nerd mode without overrides", () => {
    const resolved = resolveConfiguredIcons("nerd");
    expect(resolved.mode).toBe("nerd");
    expect(resolved.cwd).toBe(NERD_DEFAULT_ICONS.cwd);
    expect(resolved.git).toBe(NERD_DEFAULT_ICONS.git);
    expect(resolved.os).toBe(NERD_DEFAULT_ICONS.os);
  });

  it("returns ASCII glyphs for ascii mode without overrides", () => {
    const resolved = resolveConfiguredIcons("ascii");
    expect(resolved.mode).toBe("ascii");
    expect(resolved.cwd).toBe(ASCII_DEFAULT_ICONS.cwd);
    expect(resolved.git).toBe(ASCII_DEFAULT_ICONS.git);
    expect(resolved.os).toBe(ASCII_DEFAULT_ICONS.os);
  });

  it("returns Nerd Font glyphs for auto mode (falls back to nerd)", () => {
    const resolved = resolveConfiguredIcons("auto");
    expect(resolved.mode).toBe("auto");
    expect(resolved.git).toBe(NERD_DEFAULT_ICONS.git);
  });

  it("applies user overrides", () => {
    const resolved = resolveConfiguredIcons("nerd", { git: "my-git", cwd: "my-cwd" });
    expect(resolved.git).toBe("my-git");
    expect(resolved.cwd).toBe("my-cwd");
    // untouched keys remain at defaults
    expect(resolved.os).toBe(NERD_DEFAULT_ICONS.os);
  });

  it("honors rail override when non-empty", () => {
    const resolved = resolveConfiguredIcons("nerd", { rail: "║" });
    expect(resolved.rail).toBe("║");
  });

  it("falls back to default rail when override is empty string", () => {
    const resolved = resolveConfiguredIcons("nerd", { rail: "" });
    expect(resolved.rail).toBe(NERD_DEFAULT_ICONS.rail);
  });

  it("falls back to default rail when override is whitespace only", () => {
    const resolved = resolveConfiguredIcons("ascii", { rail: "   " });
    expect(resolved.rail).toBe(ASCII_DEFAULT_ICONS.rail);
  });

  it("includes all expected keys in the resolved result", () => {
    const resolved = resolveConfiguredIcons("nerd");
    for (const key of ICON_GLYPH_KEYS) {
      expect(resolved).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeSymbol
// ---------------------------------------------------------------------------
describe("resolveRuntimeSymbol", () => {
  it("returns the nerd symbol when mode is 'nerd'", () => {
    expect(resolveRuntimeSymbol("nodejs", "\ue718", "nerd")).toBe("\ue718");
  });

  it("returns the nerd symbol when mode is 'auto' (not ascii)", () => {
    expect(resolveRuntimeSymbol("nodejs", "\ue718", "auto")).toBe("\ue718");
  });

  it("returns the ascii fallback when mode is 'ascii'", () => {
    expect(resolveRuntimeSymbol("nodejs", "\ue718", "ascii")).toBe("node");
  });

  it("returns the ascii fallback for other known runtime names", () => {
    expect(resolveRuntimeSymbol("python", "\ue73c", "ascii")).toBe("py");
    expect(resolveRuntimeSymbol("golang", "\ue724", "ascii")).toBe("go");
    expect(resolveRuntimeSymbol("rust", "\ue7a8", "ascii")).toBe("rs");
    expect(resolveRuntimeSymbol("bun", "\ue76f", "ascii")).toBe("bun");
  });

  it("falls back to first 3 chars of name for unknown runtimes in ascii mode", () => {
    expect(resolveRuntimeSymbol("unknown-runtime", "nerd-sym", "ascii")).toBe("unk");
  });

  it("falls back to '*' for empty name in ascii mode", () => {
    expect(resolveRuntimeSymbol("", "nerd-sym", "ascii")).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// resolveOsIcon
// ---------------------------------------------------------------------------
describe("resolveOsIcon", () => {
  it("returns custom configured icon when it differs from the mode default", () => {
    const result = resolveOsIcon("custom-os-icon", "nerd", "linux");
    expect(result).toBe("custom-os-icon");
  });

  it("returns the platform-mapped nerd icon when configured icon matches mode default", () => {
    const nerdDefault = NERD_DEFAULT_ICONS.os;
    const result = resolveOsIcon(nerdDefault, "nerd", "darwin");
    expect(result).toBe("\uf179");
  });

  it("returns the platform-mapped ascii icon when configured icon matches mode default", () => {
    const asciiDefault = ASCII_DEFAULT_ICONS.os;
    const result = resolveOsIcon(asciiDefault, "ascii", "linux");
    expect(result).toBe("linux");
  });

  it("returns configured icon for unknown platform", () => {
    const nerdDefault = NERD_DEFAULT_ICONS.os;
    const result = resolveOsIcon(nerdDefault, "nerd", "freebsd" as NodeJS.Platform);
    expect(result).toBe(nerdDefault);
  });

  it("uses auto mode (defaults to nerd) for platform mapping", () => {
    const nerdDefault = NERD_DEFAULT_ICONS.os;
    const result = resolveOsIcon(nerdDefault, "auto", "win32");
    expect(result).toBe("\uf17a");
  });
});

// ---------------------------------------------------------------------------
// resolvePackageIcon
// ---------------------------------------------------------------------------
describe("resolvePackageIcon", () => {
  it("returns configured override when non-empty", () => {
    expect(resolvePackageIcon("custom-pkg", "nerd")).toBe("custom-pkg");
  });

  it("falls back to nerd default when configured is empty", () => {
    expect(resolvePackageIcon("", "nerd")).toBe(NERD_DEFAULT_ICONS.package);
  });

  it("falls back to ascii default when configured is empty and mode is ascii", () => {
    expect(resolvePackageIcon("", "ascii")).toBe(ASCII_DEFAULT_ICONS.package);
  });

  it("returns the configured icon even when it matches mode default (no platform remapping)", () => {
    // Unlike OsIcon, PackageIcon has no platform remapping
    const nerdDefault = NERD_DEFAULT_ICONS.package;
    expect(resolvePackageIcon(nerdDefault, "nerd")).toBe(nerdDefault);
  });
});
