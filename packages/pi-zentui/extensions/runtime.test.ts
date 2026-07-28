import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Mock node:fs — we intercept existsSync and statSync so detectRuntime works
// without a real filesystem. readdirSync is left as-is for cache tests.
// ---------------------------------------------------------------------------

const FAKE_FS_EXISTING: Set<string> = new Set();

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn((p: unknown) => FAKE_FS_EXISTING.has(String(p))),
	};
});

// Mock child_process to avoid real execFileAsync calls in cache-less tests.
// The runtime module promisifies execFile; we mock execFile directly.
vi.mock("node:child_process", async () => {
	const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
	return {
		...actual,
		execFile: vi.fn(
			(
				_command: string,
				_args?: readonly string[],
				_options?: unknown,
				callback?: (err: Error | null, stdout: string, stderr: string) => void,
			) => {
				// When callback is provided, invoke it asynchronously.
				if (callback) {
					setImmediate(() => callback(null, "", ""));
					return {} as unknown as import("node:child_process").ChildProcess;
				}
				// promisified path (no callback) — return a fake child process.
				return {} as unknown as import("node:child_process").ChildProcess;
			},
		),
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";

function setExistingFiles(...names: string[]): void {
	FAKE_FS_EXISTING.clear();
	for (const name of names) {
		FAKE_FS_EXISTING.add(path.join("/fake/project", name));
	}
}

const CWD = "/fake/project";

function mkCwd(filename: string): string {
	return path.join(CWD, filename);
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
	detectRuntime,
	clearRuntimeInfoCache,
	runtimeMetadata,
	type RuntimeDef,
} from "./runtime";

// ===========================================================================
// detectRuntime — file-based detection
// ===========================================================================

describe("detectRuntime", () => {
	beforeEach(() => {
		FAKE_FS_EXISTING.clear();
	});

	it("detects nodejs when package.json exists", () => {
		setExistingFiles("package.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("nodejs");
	});

	it("detects python when pyproject.toml exists", () => {
		setExistingFiles("pyproject.toml");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("python");
	});

	it("detects python when requirements.txt exists", () => {
		setExistingFiles("requirements.txt");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("python");
	});

	it("detects rust when Cargo.toml exists", () => {
		setExistingFiles("Cargo.toml");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("rust");
	});

	it("detects golang when go.mod exists", () => {
		setExistingFiles("go.mod");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("golang");
	});

	it("detects bun when bun.lock exists", () => {
		setExistingFiles("bun.lock");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("bun");
	});

	it("detects deno when deno.json exists", () => {
		setExistingFiles("deno.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("deno");
	});

	it("detects xmake (build system) before lua when both xmake.lua and .luarc.json present", () => {
		setExistingFiles("xmake.lua", ".luarc.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		// xmake has higher priority than lua
		expect(result!.name).toBe("xmake");
	});

	it("detects lua when .luarc.json exists but no xmake.lua", () => {
		setExistingFiles(".luarc.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("lua");
	});

	it("detects ruby when Gemfile exists", () => {
		setExistingFiles("Gemfile");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("ruby");
	});

	it("detects java when .java-version exists", () => {
		setExistingFiles(".java-version");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("java");
	});

	it("detects elixir when mix.exs exists", () => {
		setExistingFiles("mix.exs");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("elixir");
	});

	it("detects zig when build.zig exists", () => {
		setExistingFiles("build.zig");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("zig");
	});

	it("returns undefined when nothing matches", () => {
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// excludedFiles
	// -----------------------------------------------------------------------

	it("bun.lock excludes nodejs detection (bun wins)", () => {
		// bun.lock is an excludedFiles for nodejs, so nodejs shouldn't match.
		// bun is PRIORITY_COMMON (50) and is checked before nodejs at the same priority.
		// Both are PRIORITY_COMMON, sorted by array order: bun comes first.
		setExistingFiles("bun.lock", "package.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("bun");
	});

	it("bunfig.toml excludes nodejs detection", () => {
		setExistingFiles("bunfig.toml", "package.json");
		const result = detectRuntime(CWD, [], {});
		// nodejs has bunfig.toml as excluded — but no other runtime matches
		expect(result).toBeUndefined();
	});
});

// ===========================================================================
// detectRuntime — extension-based detection
// ===========================================================================

describe("detectRuntime — extension-based detection", () => {
	beforeEach(() => {
		FAKE_FS_EXISTING.clear();
	});

	it("detects lua from .lua file entries", () => {
		const result = detectRuntime(CWD, ["main.lua", "other.txt"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("lua");
	});

	it("detects cpp from .cpp file entries", () => {
		const result = detectRuntime(CWD, ["main.cpp"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("cpp");
	});

	it("detects zig from .zig file entries", () => {
		const result = detectRuntime(CWD, ["main.zig"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("zig");
	});

	it("detects c from .c file entries", () => {
		const result = detectRuntime(CWD, ["main.c"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("c");
	});

	it("detects swift from .swift file entries", () => {
		const result = detectRuntime(CWD, ["main.swift"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("swift");
	});

	it("detects kotlin from .kt file entries", () => {
		const result = detectRuntime(CWD, ["main.kt"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("kotlin");
	});

	it("detects dart from .dart file entries", () => {
		const result = detectRuntime(CWD, ["main.dart"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("dart");
	});

	it("detects fortran from .f90 file entries", () => {
		const result = detectRuntime(CWD, ["main.f90"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("fortran");
	});
});

// ===========================================================================
// detectRuntime — environment-based detection
// ===========================================================================

describe("detectRuntime — environment-based detection", () => {
	beforeEach(() => {
		FAKE_FS_EXISTING.clear();
	});

	it("detects conda from CONDA_DEFAULT_ENV", () => {
		const result = detectRuntime(CWD, [], { CONDA_DEFAULT_ENV: "myenv" });
		expect(result).toBeDefined();
		expect(result!.name).toBe("conda");
	});

	it("does NOT detect conda when CONDA_DEFAULT_ENV is empty", () => {
		const result = detectRuntime(CWD, [], { CONDA_DEFAULT_ENV: "  " });
		expect(result).toBeUndefined();
	});

	it("detects nix_shell from IN_NIX_SHELL=pure", () => {
		const result = detectRuntime(CWD, [], { IN_NIX_SHELL: "pure" });
		expect(result).toBeDefined();
		expect(result!.name).toBe("nix_shell");
	});

	it("detects nix_shell from IN_NIX_SHELL=impure", () => {
		const result = detectRuntime(CWD, [], { IN_NIX_SHELL: "impure" });
		expect(result).toBeDefined();
		expect(result!.name).toBe("nix_shell");
	});

	it("does NOT detect nix_shell for other IN_NIX_SHELL values", () => {
		const result = detectRuntime(CWD, [], { IN_NIX_SHELL: "1" });
		expect(result).toBeUndefined();
	});

	it("detects meson from MESON_DEVENV=1 + MESON_PROJECT_NAME", () => {
		const result = detectRuntime(CWD, [], {
			MESON_DEVENV: "1",
			MESON_PROJECT_NAME: "myproject",
		});
		expect(result).toBeDefined();
		expect(result!.name).toBe("meson");
	});

	it("does NOT detect meson when MESON_DEVENV is not '1'", () => {
		const result = detectRuntime(CWD, [], {
			MESON_DEVENV: "0",
			MESON_PROJECT_NAME: "myproject",
		});
		expect(result).toBeUndefined();
	});

	it("detects guix_shell from GUIX_ENVIRONMENT", () => {
		const result = detectRuntime(CWD, [], { GUIX_ENVIRONMENT: "/gnu/store/..." });
		expect(result).toBeDefined();
		expect(result!.name).toBe("guix_shell");
	});

	it("does NOT detect guix_shell when GUIX_ENVIRONMENT is empty", () => {
		const result = detectRuntime(CWD, [], { GUIX_ENVIRONMENT: "  " });
		expect(result).toBeUndefined();
	});

	it("detects spack from SPACK_ENV", () => {
		const result = detectRuntime(CWD, [], { SPACK_ENV: "myenv" });
		expect(result).toBeDefined();
		expect(result!.name).toBe("spack");
	});

	it("does NOT detect spack when SPACK_ENV is empty", () => {
		const result = detectRuntime(CWD, [], { SPACK_ENV: "  " });
		expect(result).toBeUndefined();
	});
});

// ===========================================================================
// detectRuntime — priority ordering
// ===========================================================================

describe("detectRuntime — priority ordering", () => {
	beforeEach(() => {
		FAKE_FS_EXISTING.clear();
	});

	it("xmake (build system) detected before lua when xmake.lua present", () => {
		setExistingFiles("xmake.lua");
		// xmake.lua also matches lua's file detection, but xmake has higher priority
		const result = detectRuntime(CWD, ["main.lua"], {});
		expect(result).toBeDefined();
		expect(result!.name).toBe("xmake");
	});

	it("bun detected before nodejs when both files exist", () => {
		// bun and nodejs are both PRIORITY_COMMON, bun comes first in definition order
		setExistingFiles("bun.lock", "package.json");
		const result = detectRuntime(CWD, [], {});
		expect(result).toBeDefined();
		// bun.lock is an excludedFiles for nodejs, plus bun is first in array
		expect(result!.name).toBe("bun");
	});
});

// ===========================================================================
// clearRuntimeInfoCache
// ===========================================================================

describe("clearRuntimeInfoCache", () => {
	it("does not throw when called (cache is internal)", () => {
		expect(() => clearRuntimeInfoCache()).not.toThrow();
	});
});

// ===========================================================================
// runtimeMetadata
// ===========================================================================

describe("runtimeMetadata", () => {
	it("is a non-empty array", () => {
		expect(Array.isArray(runtimeMetadata)).toBe(true);
		expect(runtimeMetadata.length).toBeGreaterThan(0);
	});

	it("each entry has name, symbol, and style", () => {
		for (const entry of runtimeMetadata) {
			expect(entry).toHaveProperty("name");
			expect(entry).toHaveProperty("symbol");
			expect(entry).toHaveProperty("style");
			expect(typeof entry.name).toBe("string");
			expect(typeof entry.symbol).toBe("string");
			expect(typeof entry.style).toBe("string");
		}
	});

	it("contains expected runtime names", () => {
		const names = runtimeMetadata.map((r) => r.name);
		expect(names).toContain("nodejs");
		expect(names).toContain("python");
		expect(names).toContain("rust");
		expect(names).toContain("golang");
		expect(names).toContain("bun");
		expect(names).toContain("deno");
		expect(names).toContain("xmake");
		expect(names).toContain("lua");
		expect(names).toContain("java");
		expect(names).toContain("ruby");
		expect(names).toContain("zig");
		expect(names).toContain("cpp");
		expect(names).toContain("c");
		expect(names).toContain("conda");
		expect(names).toContain("nix_shell");
		expect(names).toContain("meson");
		expect(names).toContain("guix_shell");
		expect(names).toContain("spack");
	});
});
