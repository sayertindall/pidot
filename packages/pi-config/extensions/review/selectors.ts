/**
 * review/selectors.ts
 *
 * Interactive target pickers. Pure UI logic; the orchestrator just
 * forwards to the right function based on user choice. Extracted from
 * index.ts to keep that file under 400 LOC.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	checkoutPr,
	getCurrentBranch,
	getDefaultBranch,
	getLocalBranches,
	getPrInfo,
	getRecentCommits,
	hasPendingChanges,
	parsePrReference,
} from "./targets";
import type { ReviewTarget } from "./types";

type SelectableContext = ExtensionCommandContext & { hasUI: boolean };

export async function selectTargetInteractive(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<ReviewTarget | null> {
	if (!ctx.hasUI) return null;
	const choice = await ctx.ui.select("Review target:", [
		"Uncommitted changes",
		"Branch diff",
		"Commit",
		"Pull request",
	]);
	if (!choice) return null;
	switch (choice) {
		case "Uncommitted changes":
			return { type: "uncommitted" };
		case "Branch diff":
			return pickBranchTarget(pi, ctx);
		case "Commit":
			return pickCommitTarget(pi, ctx);
		case "Pull request":
			return pickPrTarget(pi, ctx);
		default:
			return null;
	}
}

async function pickBranchTarget(pi: ExtensionAPI, ctx: SelectableContext): Promise<ReviewTarget | null> {
	const branches = await getLocalBranches(pi);
	const defaultBranch = await getDefaultBranch(pi);
	const current = branches.length > 0 ? await getCurrentBranch(pi) : null;
	const candidates = current ? branches.filter((b) => b !== current) : branches;
	if (candidates.length === 0) {
		ctx.ui.notify(current ? `No other branches (current: ${current})` : "No branches found", "error");
		return null;
	}
	const sorted = [...candidates].sort((a, b) => {
		if (a === defaultBranch) return -1;
		if (b === defaultBranch) return 1;
		return a.localeCompare(b);
	});
	const labels = sorted.map((b) => (b === defaultBranch ? `${b} (default)` : b));
	const picked = await ctx.ui.select("Base branch:", labels);
	if (!picked) return null;
	const branch = picked.replace(/\s*\(default\)$/, "");
	return { type: "baseBranch", branch };
}

async function pickCommitTarget(pi: ExtensionAPI, ctx: SelectableContext): Promise<ReviewTarget | null> {
	const commits = await getRecentCommits(pi, 20);
	if (commits.length === 0) {
		ctx.ui.notify("No commits found", "error");
		return null;
	}
	const labels = commits.map((c) => `${c.sha.slice(0, 7)} ${c.title}`.trim());
	const picked = await ctx.ui.select("Commit to review:", labels);
	if (!picked) return null;
	const sha = picked.split(" ")[0] ?? "";
	const commit = commits.find((c) => c.sha === sha || c.sha.startsWith(sha));
	if (!commit) return null;
	return { type: "commit", sha: commit.sha, title: commit.title };
}

async function pickPrTarget(pi: ExtensionAPI, ctx: SelectableContext): Promise<ReviewTarget | null> {
	if (await hasPendingChanges(pi)) {
		ctx.ui.notify("Cannot checkout PR: uncommitted changes present.", "error");
		return null;
	}
	const prRef = await ctx.ui.input("PR number or URL:");
	if (!prRef?.trim()) return null;
	const prNumber = parsePrReference(prRef.trim());
	if (!prNumber) {
		ctx.ui.notify("Invalid PR reference.", "error");
		return null;
	}
	const prInfo = await getPrInfo(pi, prNumber);
	if (!prInfo) {
		ctx.ui.notify(`Could not find PR #${prNumber}.`, "error");
		return null;
	}
	if (await hasPendingChanges(pi)) {
		ctx.ui.notify("Cannot checkout PR: uncommitted changes appeared.", "error");
		return null;
	}
	const checkout = await checkoutPr(pi, prNumber);
	if (!checkout.success) {
		ctx.ui.notify(`Failed to checkout PR: ${checkout.error ?? "unknown"}`, "error");
		return null;
	}
	return { type: "pullRequest", prNumber, baseBranch: prInfo.baseBranch, title: prInfo.title };
}
