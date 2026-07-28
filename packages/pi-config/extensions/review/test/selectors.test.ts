/**
 * review/test/selectors.test.ts
 *
 * Tests for selectors.ts — interactive target pickers.
 * Mocks pi API (ui.select/ui.input/ui.notify/hasUI) and targets module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectTargetInteractive } from "../selectors";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Mock the targets module — selectors import from it
vi.mock("../targets", () => ({
  getLocalBranches: vi.fn(),
  getDefaultBranch: vi.fn(),
  getCurrentBranch: vi.fn(),
  getRecentCommits: vi.fn(),
  hasPendingChanges: vi.fn(),
  parsePrReference: vi.fn(),
  getPrInfo: vi.fn(),
  checkoutPr: vi.fn(),
}));

import * as targets from "../targets";

function fakeCtx(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  return {
    hasUI: true,
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      notify: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

function fakePi(): ExtensionAPI {
  return {} as ExtensionAPI;
}

describe("selectTargetInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when context has no UI", async () => {
    const ctx = fakeCtx({ hasUI: false });
    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
  });

  it("returns null when user cancels selection", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValue(null);
    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
  });

  it("returns uncommitted target when user picks uncommitted", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValue("Uncommitted changes");
    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toEqual({ type: "uncommitted" });
  });

  it("calls ui.select with correct options", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValue("Uncommitted changes");
    await selectTargetInteractive(fakePi(), ctx);
    expect(ctx.ui.select).toHaveBeenCalledWith("Review target:", [
      "Uncommitted changes",
      "Branch diff",
      "Commit",
      "Pull request",
    ]);
  });

  it("returns null for unknown choice", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValue("Unknown option");
    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
  });
});

describe("pickBranchTarget (via selectTargetInteractive) ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("picks a branch and returns baseBranch target", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any)
      .mockResolvedValueOnce("Branch diff") // first select: target type
      .mockResolvedValueOnce("develop"); // second select: base branch
    (targets.getLocalBranches as any).mockResolvedValue(["main", "develop", "feature"]);
    (targets.getDefaultBranch as any).mockResolvedValue("main");
    (targets.getCurrentBranch as any).mockResolvedValue("feature");

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toEqual({ type: "baseBranch", branch: "develop" });
  });

  it("sorts default branch first", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any)
      .mockResolvedValueOnce("Branch diff")
      .mockResolvedValueOnce("main (default)");
    (targets.getLocalBranches as any).mockResolvedValue(["develop", "main", "feature"]);
    (targets.getDefaultBranch as any).mockResolvedValue("main");
    (targets.getCurrentBranch as any).mockResolvedValue("feature");

    // Verify the sorting: default branch should be first with (default) label
    await selectTargetInteractive(fakePi(), ctx);
    const branchLabels = (ctx.ui.select as any).mock.calls[1][1];
    expect(branchLabels[0]).toBe("main (default)");
  });

  it("excludes current branch from candidates", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any)
      .mockResolvedValueOnce("Branch diff")
      .mockResolvedValueOnce("develop");
    (targets.getLocalBranches as any).mockResolvedValue(["main", "develop", "feature"]);
    (targets.getDefaultBranch as any).mockResolvedValue("main");
    (targets.getCurrentBranch as any).mockResolvedValue("feature");

    await selectTargetInteractive(fakePi(), ctx);
    // feature should NOT be in the candidate list
    const branchLabels: string[] = (ctx.ui.select as any).mock.calls[1][1];
    expect(branchLabels).not.toContain("feature");
    expect(branchLabels).not.toContain("feature (default)");
  });

  it("notifies error when no other branches exist", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Branch diff");
    (targets.getLocalBranches as any).mockResolvedValue(["feature"]);
    (targets.getDefaultBranch as any).mockResolvedValue("main");
    (targets.getCurrentBranch as any).mockResolvedValue("feature");

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No other branches (current: feature)",
      "error",
    );
  });
});

describe("pickCommitTarget (via selectTargetInteractive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("picks a commit and returns commit target", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any)
      .mockResolvedValueOnce("Commit")
      .mockResolvedValueOnce("abc1234 Fix login bug");
    (targets.getRecentCommits as any).mockResolvedValue([
      { sha: "abc1234", title: "Fix login bug" },
      { sha: "bcd2345", title: "Add tests" },
    ]);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toEqual({ type: "commit", sha: "abc1234", title: "Fix login bug" });
  });

  it("notifies error when no commits exist", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Commit");
    (targets.getRecentCommits as any).mockResolvedValue([]);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith("No commits found", "error");
  });
});

describe("pickPrTarget (via selectTargetInteractive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("picks a PR and returns pullRequest target", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (ctx.ui.input as any).mockResolvedValue("42");
    (targets.hasPendingChanges as any).mockResolvedValue(false);
    (targets.parsePrReference as any).mockReturnValue(42);
    (targets.getPrInfo as any).mockResolvedValue({
      baseBranch: "main",
      title: "Fix critical bug",
      headBranch: "fix/bug",
    });
    (targets.checkoutPr as any).mockResolvedValue({ success: true });

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toEqual({
      type: "pullRequest",
      prNumber: 42,
      baseBranch: "main",
      title: "Fix critical bug",
    });
  });

  it("blocks when uncommitted changes exist", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (targets.hasPendingChanges as any).mockResolvedValue(true);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cannot checkout PR: uncommitted changes present.",
      "error",
    );
  });

  it("notifies error on invalid PR reference", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (ctx.ui.input as any).mockResolvedValue("not-a-pr");
    (targets.hasPendingChanges as any).mockResolvedValue(false);
    (targets.parsePrReference as any).mockReturnValue(null);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid PR reference.", "error");
  });

  it("notifies error when PR not found", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (ctx.ui.input as any).mockResolvedValue("99");
    (targets.hasPendingChanges as any).mockResolvedValue(false);
    (targets.parsePrReference as any).mockReturnValue(99);
    (targets.getPrInfo as any).mockResolvedValue(null);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Could not find PR #99.", "error");
  });

  it("notifies error on checkout failure", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (ctx.ui.input as any).mockResolvedValue("5");
    (targets.hasPendingChanges as any).mockResolvedValue(false);
    (targets.parsePrReference as any).mockReturnValue(5);
    (targets.getPrInfo as any).mockResolvedValue({
      baseBranch: "main",
      title: "Test",
      headBranch: "test",
    });
    (targets.checkoutPr as any).mockResolvedValue({ success: false, error: "Network error" });

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Failed to checkout PR: Network error",
      "error",
    );
  });

  it("returns null on empty PR input", async () => {
    const ctx = fakeCtx();
    (ctx.ui.select as any).mockResolvedValueOnce("Pull request");
    (ctx.ui.input as any).mockResolvedValue("");
    (targets.hasPendingChanges as any).mockResolvedValue(false);

    const result = await selectTargetInteractive(fakePi(), ctx);
    expect(result).toBeNull();
  });
});
