/**
 * review/targets.ts
 *
 * Git helpers for resolving review targets. Stateless module. Mirrors
 * the pre-rewrite `targets.ts` API but with stricter types and no
 * thrown errors in expected-failure paths.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReviewTarget } from "./types";

export type ExecResultLike = { stdout: string; stderr: string; code: number };

async function exec(pi: ExtensionAPI, cmd: string, args: string[]): Promise<ExecResultLike> {
	return (await pi.exec(cmd, args)) as ExecResultLike;
}

export async function getMergeBase(pi: ExtensionAPI, branch: string): Promise<string | null> {
	try {
		const upstream = await exec(pi, "git", [
			"rev-parse",
			"--abbrev-ref",
			`${branch}@{upstream}`,
		]);
		if (upstream.code === 0 && upstream.stdout.trim()) {
			const mb = await exec(pi, "git", ["merge-base", "HEAD", upstream.stdout.trim()]);
			if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
		}
		const mb = await exec(pi, "git", ["merge-base", "HEAD", branch]);
		if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
		return null;
	} catch {
		return null;
	}
}

export async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
	const r = await exec(pi, "git", ["branch", "--format=%(refname:short)"]);
	if (r.code !== 0) return [];
	return r.stdout
		.trim()
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

export async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
	const r = await exec(pi, "git", [
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"--short",
	]);
	if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().replace("origin/", "");
	const branches = await getLocalBranches(pi);
	if (branches.includes("main")) return "main";
	if (branches.includes("master")) return "master";
	return "main";
}

export async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
	const r = await exec(pi, "git", ["branch", "--show-current"]);
	return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export async function getRecentCommits(
	pi: ExtensionAPI,
	limit = 20,
): Promise<Array<{ sha: string; title: string }>> {
	const r = await exec(pi, "git", ["log", "--oneline", "-n", String(limit)]);
	if (r.code !== 0) return [];
	return r.stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const parts = line.trim().split(" ");
			const sha = parts[0] ?? "";
			const title = parts.slice(1).join(" ");
			return { sha, title };
		});
}

export async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
	const r = await exec(pi, "git", ["status", "--porcelain"]);
	if (r.code !== 0) return false;
	return r.stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.some((line) => !line.startsWith("??"));
}

export function parsePrReference(ref: string): number | null {
	const trimmed = ref.trim();
	const num = Number.parseInt(trimmed, 10);
	if (Number.isInteger(num) && num > 0) return num;
	const m = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
	if (m) {
		const n = Number.parseInt(m[1] ?? "", 10);
		if (Number.isInteger(n) && n > 0) return n;
	}
	return null;
}

export async function getPrInfo(
	pi: ExtensionAPI,
	prNumber: number,
): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
	const r = await exec(pi, "gh", [
		"pr",
		"view",
		String(prNumber),
		"--json",
		"baseRefName,title,headRefName",
	]);
	if (r.code !== 0) return null;
	try {
		const data = JSON.parse(r.stdout) as {
			baseRefName?: string;
			title?: string;
			headRefName?: string;
		};
		if (!data.baseRefName || !data.title || !data.headRefName) return null;
		return { baseBranch: data.baseRefName, title: data.title, headBranch: data.headRefName };
	} catch {
		return null;
	}
}

export async function checkoutPr(
	pi: ExtensionAPI,
	prNumber: number,
): Promise<{ success: boolean; error?: string }> {
	const r = await exec(pi, "gh", ["pr", "checkout", String(prNumber)]);
	if (r.code !== 0) return { success: false, error: r.stderr || r.stdout || "Failed to checkout PR" };
	return { success: true };
}

export function getUserFacingHint(target: ReviewTarget): string {
	switch (target.type) {
		case "uncommitted":
			return "current changes";
		case "baseBranch":
			return `changes against '${target.branch}'`;
		case "commit": {
			const short = target.sha.slice(0, 7);
			return target.title ? `commit ${short}: ${target.title}` : `commit ${short}`;
		}
		case "pullRequest": {
			const t = target.title.length > 30 ? `${target.title.slice(0, 27)}...` : target.title;
			return `PR #${target.prNumber}: ${t}`;
		}
	}
}
