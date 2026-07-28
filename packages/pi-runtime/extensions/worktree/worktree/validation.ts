import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GitWorkingTreeInfo } from "./types";

/**
 * Strip `refs/heads/` prefix from a symbolic-ref result.
 * Returns `"(detached)"` if no branch is provided.
 */
export function displayBranch(branch?: string): string {
  if (!branch) return "(detached)";
  return branch.replace(/^refs\/heads\//, "");
}

/**
 * Validate that `cwd` is inside a non-bare git working tree.
 *
 * Runs three `git` subprocesses via `pi.exec`:
 * 1. `rev-parse --is-inside-work-tree` — must be "true"
 * 2. `rev-parse --is-bare-repository` — must NOT be "true"
 * 3. `symbolic-ref -q HEAD` — best-effort branch detection
 *
 * Each call has a 5s timeout and passes through `signal` for cancellation.
 */
export async function validateGitWorkingTree(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<GitWorkingTreeInfo> {
  // 1. Check inside work tree
  const inside = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    signal,
    timeout: 5000,
  });
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    const bareCheck = await pi.exec("git", ["rev-parse", "--is-bare-repository"], {
      cwd,
      signal,
      timeout: 5000,
    });
    if (bareCheck.code === 0 && bareCheck.stdout.trim() === "true") {
      throw new Error(`Bare git repositories are not supported: ${cwd}`);
    }
    throw new Error(`Not a git working tree: ${cwd}`);
  }

  // 2. Verify not bare
  const bare = await pi.exec("git", ["rev-parse", "--is-bare-repository"], {
    cwd,
    signal,
    timeout: 5000,
  });
  if (bare.code !== 0) {
    throw new Error(`Cannot verify git repository: ${bare.stderr || bare.stdout}`);
  }
  if (bare.stdout.trim() === "true") {
    throw new Error(`Bare git repositories are not supported: ${cwd}`);
  }

  // 3. Get branch (best-effort — may be detached HEAD)
  const branchResult = await pi.exec("git", ["symbolic-ref", "-q", "HEAD"], {
    cwd,
    signal,
    timeout: 5000,
  });

  if (branchResult.code === 0) {
    const detectedBranch = branchResult.stdout.trim();
    const branch = displayBranch(detectedBranch);
    return { branch, detectedBranch };
  }

  return {};
}
