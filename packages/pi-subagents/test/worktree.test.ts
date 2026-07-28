import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWorktree, createWorktree, pruneWorktrees } from "../extensions/subagents/worktree.ts";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("worktree", () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "pi-subagents-worktree-"));
		git(repo, ["init", "-q"]);
		git(repo, ["config", "user.email", "test@example.com"]);
		git(repo, ["config", "user.name", "Test"]);
		writeFileSync(join(repo, "README.md"), "hello\n");
		git(repo, ["add", "-A"]);
		git(repo, ["commit", "-q", "-m", "initial"]);
	});

	afterEach(() => {
		try {
			pruneWorktrees(repo);
		} catch {
			/* ignore */
		}
		rmSync(repo, { recursive: true, force: true });
	});

	it("createWorktree returns undefined outside a git repo", () => {
		const notARepo = mkdtempSync(join(tmpdir(), "pi-subagents-notrepo-"));
		try {
			expect(createWorktree(notARepo, "agent-1")).toBeUndefined();
		} finally {
			rmSync(notARepo, { recursive: true, force: true });
		}
	});

	it("createWorktree creates a detached worktree at HEAD, workPath equals path at repo root", () => {
		const wt = createWorktree(repo, "agent-1");
		expect(wt).toBeDefined();
		if (!wt) return;
		expect(wt.path).toContain("pi-agent-agent-1");
		expect(wt.workPath).toBe(wt.path);
		expect(wt.baseSha).toBe(git(repo, ["rev-parse", "HEAD"]));
		cleanupWorktree(repo, wt, "test");
	});

	it("cleanupWorktree with no changes removes the worktree and reports hasChanges: false", () => {
		const wt = createWorktree(repo, "agent-2");
		expect(wt).toBeDefined();
		if (!wt) return;
		const result = cleanupWorktree(repo, wt, "no-op task");
		expect(result.hasChanges).toBe(false);
		expect(result.branch).toBeUndefined();
	});

	it("cleanupWorktree with changes commits, branches, and removes the worktree dir", () => {
		const wt = createWorktree(repo, "agent-3");
		expect(wt).toBeDefined();
		if (!wt) return;
		writeFileSync(join(wt.path, "new-file.txt"), "changed\n");

		const result = cleanupWorktree(repo, wt, "made a change");
		expect(result.hasChanges).toBe(true);
		expect(result.branch).toBe("pi-agent-agent-3");

		const branches = git(repo, ["branch", "--list", "pi-agent-agent-3"]);
		expect(branches).toContain("pi-agent-agent-3");
	});

	it("cleanupWorktree retries with a timestamp-suffixed branch name on collision", () => {
		// Pre-create a branch with the name cleanupWorktree would use.
		git(repo, ["branch", "pi-agent-agent-4"]);

		const wt = createWorktree(repo, "agent-4");
		expect(wt).toBeDefined();
		if (!wt) return;
		writeFileSync(join(wt.path, "new-file.txt"), "changed\n");

		const result = cleanupWorktree(repo, wt, "collides with an existing branch");
		expect(result.hasChanges).toBe(true);
		expect(result.branch).toBeDefined();
		expect(result.branch).not.toBe("pi-agent-agent-4");
		expect(result.branch).toMatch(/^pi-agent-agent-4-\d+$/);
	});

	it("pruneWorktrees clears a worktree registration whose directory was removed out-of-band", () => {
		const wt = createWorktree(repo, "agent-5");
		expect(wt).toBeDefined();
		if (!wt) return;
		rmSync(wt.path, { recursive: true, force: true });

		// Before prune, git still thinks the worktree exists (registration is stale).
		expect(git(repo, ["worktree", "list"])).toContain("agent-5");
		pruneWorktrees(repo);
		expect(git(repo, ["worktree", "list"])).not.toContain("agent-5");
	});
});
