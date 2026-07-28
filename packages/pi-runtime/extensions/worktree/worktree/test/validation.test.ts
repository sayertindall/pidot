import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGitWorkingTree, displayBranch } from '../validation';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pi-worktree-val-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fakePi() {
  return {
    exec: async (cmd: string, args: readonly string[], opts?: any) => {
      try {
        const stdout = execFileSync(cmd, args as string[], {
          cwd: opts?.cwd,
          timeout: opts?.timeout,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { code: 0, stdout, stderr: "", killed: false };
      } catch (err: any) {
        return {
          code: err.status ?? 1,
          stdout: err.stdout?.toString() ?? "",
          stderr: err.stderr?.toString() ?? "",
          killed: err.killed ?? false,
        };
      }
    },
  } as any;
}

function initGitRepo(cwd: string, branch?: string): void {
  const initArgs = branch ? ["init", "-b", branch] : ["init"];
  execFileSync("git", initArgs, { cwd });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  writeFileSync(join(cwd, "test.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-m", "init"], { cwd });
}

describe("validateGitWorkingTree", () => {
  it("returns branch info for a valid git worktree", async () => {
    initGitRepo(tmp);
    const info = await validateGitWorkingTree(fakePi(), tmp);
    expect(info.branch).toBe("main");
    expect(info.detectedBranch).toBe("refs/heads/main");
  });

  it("returns branch info for a non-main default branch", async () => {
    initGitRepo(tmp, "trunk");
    const info = await validateGitWorkingTree(fakePi(), tmp);
    expect(info.branch).toBe("trunk");
    expect(info.detectedBranch).toBe("refs/heads/trunk");
  });

  it("throws for a non-git directory", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "pi-worktree-nogit-"));
    try {
      await validateGitWorkingTree(fakePi(), nonGit);
      expect.unreachable("expected to throw");
    } catch (err: any) {
      expect(err.message).toContain("Not a git working tree");
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("throws for a non-existent directory", async () => {
    try {
      await validateGitWorkingTree(fakePi(), "/nonexistent/path/xyz");
      expect.unreachable("expected to throw");
    } catch (err: any) {
      expect(err.message).toContain("Not a git working tree");
    }
  });

  it("detects detached HEAD", async () => {
    initGitRepo(tmp);
    execFileSync("git", ["checkout", "--detach"], { cwd: tmp });

    const info = await validateGitWorkingTree(fakePi(), tmp);
    expect(info.branch).toBeUndefined();
    expect(info.detectedBranch).toBeUndefined();
  });

  it("passes signal to pi.exec", async () => {
    initGitRepo(tmp);
    const controller = new AbortController();
    const pi = fakePi();
    const originalExec = pi.exec;
    pi.exec = async (cmd: string, args: readonly string[], opts?: any) => {
      expect(opts?.signal).toBe(controller.signal);
      return originalExec(cmd, args, opts);
    };

    await validateGitWorkingTree(pi, tmp, controller.signal);
  });
});

describe("displayBranch", () => {
  it("strips refs/heads/ prefix", () => {
    expect(displayBranch("refs/heads/main")).toBe("main");
    expect(displayBranch("refs/heads/feature/branch")).toBe("feature/branch");
  });

  it("returns (detached) for undefined", () => {
    expect(displayBranch()).toBe("(detached)");
    expect(displayBranch(undefined)).toBe("(detached)");
  });

  it("returns input unchanged if no prefix match", () => {
    expect(displayBranch("main")).toBe("main");
    expect(displayBranch("refs/tags/v1.0")).toBe("refs/tags/v1.0");
  });
});
