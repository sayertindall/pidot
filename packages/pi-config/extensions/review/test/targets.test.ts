/**
 * review/test/targets.test.ts
 *
 * Tests for targets.ts — git helpers and pure formatting functions.
 * parsePrReference and getUserFacingHint are pure functions (no mocks).
 * Git helpers mock pi.exec via vi.fn() on a fake ExtensionAPI.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parsePrReference,
  getUserFacingHint,
  getLocalBranches,
  getDefaultBranch,
  getCurrentBranch,
  getRecentCommits,
  hasPendingChanges,
  getPrInfo,
  checkoutPr,
  getMergeBase,
} from "../targets";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReviewTarget } from "../types";

// --- Pure function tests (no mocks needed) ---

describe("parsePrReference", () => {
  it("parses a plain numeric string", () => {
    expect(parsePrReference("42")).toBe(42);
  });

  it("parses a number with spaces", () => {
    expect(parsePrReference("  123  ")).toBe(123);
  });

  it("parses a GitHub PR URL", () => {
    expect(parsePrReference("https://github.com/org/repo/pull/99")).toBe(99);
  });

  it("parses a GitHub PR URL with trailing slash", () => {
    expect(parsePrReference("github.com/user/project/pull/77/")).toBe(77);
  });

  it("returns null for non-numeric strings", () => {
    expect(parsePrReference("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePrReference("")).toBeNull();
    expect(parsePrReference("   ")).toBeNull();
  });

  it("returns null for zero", () => {
    expect(parsePrReference("0")).toBeNull();
  });

  it("returns null for negative numbers", () => {
    expect(parsePrReference("-5")).toBeNull();
  });

  it("parses leading digits from float-like strings (parseInt behavior)", () => {
    // parseInt("3.14") === 3, which is an integer > 0
    expect(parsePrReference("3.14")).toBe(3);
  });

  it("returns null for GitHub URL with non-PR path", () => {
    expect(parsePrReference("https://github.com/org/repo/issues/5")).toBeNull();
  });

  it("handles very large PR numbers", () => {
    expect(parsePrReference("999999")).toBe(999999);
  });
});

describe("getUserFacingHint", () => {
  it("describes uncommitted target", () => {
    expect(getUserFacingHint({ type: "uncommitted" })).toBe("current changes");
  });

  it("describes baseBranch target", () => {
    const target: ReviewTarget = { type: "baseBranch", branch: "develop" };
    expect(getUserFacingHint(target)).toBe("changes against 'develop'");
  });

  it("describes commit target with title", () => {
    const target: ReviewTarget = { type: "commit", sha: "abc1234567890def", title: "Fix login bug" };
    expect(getUserFacingHint(target)).toBe("commit abc1234: Fix login bug");
  });

  it("describes commit target without title", () => {
    const target: ReviewTarget = { type: "commit", sha: "deadbeef1234567" };
    expect(getUserFacingHint(target)).toBe("commit deadbee");
  });

  it("describes pullRequest target with short title", () => {
    const target: ReviewTarget = {
      type: "pullRequest",
      prNumber: 42,
      baseBranch: "main",
      title: "Update deps",
    };
    expect(getUserFacingHint(target)).toBe("PR #42: Update deps");
  });

  it("truncates long PR titles", () => {
    const target: ReviewTarget = {
      type: "pullRequest",
      prNumber: 99,
      baseBranch: "main",
      title: "This is a very long pull request title that should be truncated",
    };
    const hint = getUserFacingHint(target);
    expect(hint).toContain("PR #99:");
    expect(hint).toContain("...");
    expect(hint.length).toBeLessThan(50); // 30 chars + "..."
  });
});

// --- Git helper tests (mock pi.exec) ---

type ExecResult = { stdout: string; stderr: string; code: number };
type ExecHandler = (cmd: string, args: string[]) => ExecResult;

function mockPi(handler: ExecHandler) {
  return {
    exec: vi.fn((cmd: string, args: string[]) => Promise.resolve(handler(cmd, args))),
  } as unknown as ExtensionAPI;
}

describe("getLocalBranches", () => {
  it("returns branch list on success", async () => {
    const pi = mockPi(() => ({ stdout: "main\nfeature-x\nbugfix", stderr: "", code: 0 }));
    const branches = await getLocalBranches(pi);
    expect(branches).toEqual(["main", "feature-x", "bugfix"]);
  });

  it("returns empty array on non-zero exit", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "fatal", code: 128 }));
    expect(await getLocalBranches(pi)).toEqual([]);
  });

  it("filters empty lines", async () => {
    const pi = mockPi(() => ({ stdout: "main\n\n\nfeature\n\n", stderr: "", code: 0 }));
    expect(await getLocalBranches(pi)).toEqual(["main", "feature"]);
  });
});

describe("getDefaultBranch", () => {
  it("returns main from symbolic-ref", async () => {
    const pi = mockPi((_cmd, args) => {
      if (args[0] === "symbolic-ref") return { stdout: "origin/main\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    });
    expect(await getDefaultBranch(pi)).toBe("main");
  });

  it("falls back to main when symbolic-ref fails", async () => {
    const pi = mockPi((_cmd, args) => {
      if (args[0] === "symbolic-ref") return { stdout: "", stderr: "fatal", code: 128 };
      if (args[0] === "branch") return { stdout: "main\nfeature", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    });
    expect(await getDefaultBranch(pi)).toBe("main");
  });

  it("falls back to master when main not found", async () => {
    const pi = mockPi((_cmd, args) => {
      if (args[0] === "symbolic-ref") return { stdout: "", stderr: "fatal", code: 128 };
      if (args[0] === "branch") return { stdout: "develop\nmaster", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    });
    expect(await getDefaultBranch(pi)).toBe("master");
  });
});

describe("getCurrentBranch", () => {
  it("returns current branch name", async () => {
    const pi = mockPi(() => ({ stdout: "feature-x\n", stderr: "", code: 0 }));
    expect(await getCurrentBranch(pi)).toBe("feature-x");
  });

  it("returns null on failure", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "error", code: 128 }));
    expect(await getCurrentBranch(pi)).toBeNull();
  });
});

describe("getRecentCommits", () => {
  it("parses commit log output", async () => {
    const pi = mockPi(() => ({
      stdout: "abc1234 Fix login\nbcd2345 Add tests\n",
      stderr: "",
      code: 0,
    }));
    const commits = await getRecentCommits(pi, 10);
    expect(commits).toEqual([
      { sha: "abc1234", title: "Fix login" },
      { sha: "bcd2345", title: "Add tests" },
    ]);
  });

  it("returns empty array on non-zero exit", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "error", code: 1 }));
    expect(await getRecentCommits(pi)).toEqual([]);
  });

  it("passes limit to git", async () => {
    const execSpy = vi.fn(() => Promise.resolve({ stdout: "", stderr: "", code: 0 }));
    const pi = { exec: execSpy } as unknown as ExtensionAPI;
    await getRecentCommits(pi, 5);
    expect(execSpy).toHaveBeenCalledWith("git", ["log", "--oneline", "-n", "5"]);
  });
});

describe("hasPendingChanges", () => {
  it("returns true when tracked files changed", async () => {
    const pi = mockPi(() => ({ stdout: " M src/index.ts\n", stderr: "", code: 0 }));
    expect(await hasPendingChanges(pi)).toBe(true);
  });

  it("returns false for only untracked files", async () => {
    const pi = mockPi(() => ({ stdout: "?? newfile.txt\n", stderr: "", code: 0 }));
    expect(await hasPendingChanges(pi)).toBe(false);
  });

  it("returns false when clean", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "", code: 0 }));
    expect(await hasPendingChanges(pi)).toBe(false);
  });

  it("returns false on git error", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "fatal", code: 128 }));
    expect(await hasPendingChanges(pi)).toBe(false);
  });
});

describe("getPrInfo", () => {
  it("parses gh pr view output", async () => {
    const pi = mockPi(() => ({
      stdout: JSON.stringify({ baseRefName: "main", title: "Fix bug", headRefName: "feature/fix" }),
      stderr: "",
      code: 0,
    }));
    const info = await getPrInfo(pi, 42);
    expect(info).toEqual({ baseBranch: "main", title: "Fix bug", headBranch: "feature/fix" });
  });

  it("returns null on non-zero exit", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "not found", code: 1 }));
    expect(await getPrInfo(pi, 99)).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const pi = mockPi(() => ({ stdout: "not json", stderr: "", code: 0 }));
    expect(await getPrInfo(pi, 1)).toBeNull();
  });

  it("returns null when fields missing", async () => {
    const pi = mockPi(() => ({
      stdout: JSON.stringify({ baseRefName: "main" }), // missing title and headRefName
      stderr: "",
      code: 0,
    }));
    expect(await getPrInfo(pi, 1)).toBeNull();
  });
});

describe("checkoutPr", () => {
  it("returns success on exit 0", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "", code: 0 }));
    expect(await checkoutPr(pi, 5)).toEqual({ success: true });
  });

  it("returns failure with error on non-zero exit", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "PR not found", code: 1 }));
    expect(await checkoutPr(pi, 99)).toEqual({ success: false, error: "PR not found" });
  });
});

describe("getMergeBase", () => {
  it("returns merge base via upstream", async () => {
    const pi = mockPi((_cmd, args) => {
      if (args[0] === "rev-parse") return { stdout: "origin/main\n", stderr: "", code: 0 };
      if (args[0] === "merge-base") return { stdout: "abc123\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    });
    expect(await getMergeBase(pi, "main")).toBe("abc123");
  });

  it("falls back to direct merge-base when upstream fails", async () => {
    const pi = mockPi((_cmd, args) => {
      if (args[0] === "rev-parse") return { stdout: "", stderr: "no upstream", code: 128 };
      if (args[0] === "merge-base") return { stdout: "def456\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 1 };
    });
    expect(await getMergeBase(pi, "develop")).toBe("def456");
  });

  it("returns null when both fail", async () => {
    const pi = mockPi(() => ({ stdout: "", stderr: "fatal", code: 128 }));
    expect(await getMergeBase(pi, "nonexistent")).toBeNull();
  });
});
