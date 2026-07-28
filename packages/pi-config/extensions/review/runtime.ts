/**
 * review/runtime.ts
 *
 * Prompt builder for review launches. Combines the shipped rubric, the
 * resolved target, and any project-level REVIEW_GUIDELINES.md.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMergeBase } from "./targets";
import type { ReviewTarget } from "./types";

const SHIPPED_GUIDELINES_PATH = fileURLToPath(
	new URL("./review-guidelines.md", import.meta.url),
);

const FALLBACK_RUBRIC = `# Review Guidelines

You are acting as a code reviewer for a proposed code change. Flag issues that
meaningfully impact accuracy, performance, security, or maintainability, that
are discrete and actionable, and that were introduced by the reviewed change.

## Priority levels

Tag each finding with a priority level in the title:

- [P0] - Drop everything to fix. Blocking release/operations.
- [P1] - Urgent. Address in the next cycle.
- [P2] - Normal. Fix eventually.
- [P3] - Low. Nice to have.

## Output format

1. List each finding with its priority tag, file location, and explanation.
2. Provide an overall verdict: "correct" or "needs attention".
3. Findings must reference locations that overlap with the actual diff.
4. End with a "Human Reviewer Callouts (Non-Blocking)" section listing only
   applicable callouts (migrations, new/changed dependencies, auth/permission
   changes, backwards-incompatible schema/API changes, destructive operations).
   If none apply, write "- (none)".`;

export function loadDefaultRubric(): string {
	try {
		const content = readFileSync(SHIPPED_GUIDELINES_PATH, "utf8").trim();
		return content.length > 0 ? content : FALLBACK_RUBRIC;
	} catch {
		return FALLBACK_RUBRIC;
	}
}

async function readFileTrimmed(filePath: string): Promise<string | null> {
	try {
		const content = readFileSync(filePath, "utf8");
		const trimmed = content.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

async function findProjectGuidelines(cwd: string): Promise<string | null> {
	let current = cwd;
	while (true) {
		const piDir = join(current, ".pi");
		if (existsSync(piDir)) {
			return readFileTrimmed(join(current, "REVIEW_GUIDELINES.md"));
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export async function loadReviewGuidelines(cwd: string): Promise<string | null> {
	const project = await findProjectGuidelines(cwd);
	if (project) return project;
	return readFileTrimmed(join(getAgentDir(), "REVIEW_GUIDELINES.md"));
}

export const REVIEW_SUMMARY_PROMPT = `We are leaving a code-review branch and returning to the main coding branch.
Create a structured handoff that can be used immediately to implement fixes.

You MUST summarize the review that happened in this branch so findings can be acted on.
Do not omit findings: include every actionable issue that was identified.

Required sections (in order):

## Review Scope
- What was reviewed (files/paths, changes, and scope)

## Verdict
- "correct" or "needs attention"

## Findings
For EACH finding, include:
- Priority tag ([P0]..[P3]) and short title
- File location (\`path/to/file.ext:line\`)
- Why it matters (brief)
- What should change (brief, actionable)

## Fix Queue
1. Ordered implementation checklist (highest priority first)

## Human Reviewer Callouts (Non-Blocking)
Include only applicable callouts:
- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>

If none apply, write "- (none)".

Preserve exact file paths, function names, and error messages where available.`;

const UNCOMMITTED_PROMPT =
	"Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

const LOCAL_CHANGES_REVIEW_INSTRUCTIONS =
	"Also include local working-tree changes (staged, unstaged, and untracked files) from this branch. Use `git status --porcelain`, `git diff`, `git diff --staged`, and `git ls-files --others --exclude-standard` so local fixes are part of this review.";

const BASE_BRANCH_PROMPT_WITH_MB =
	"Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide prioritized, actionable findings.";

const BASE_BRANCH_PROMPT_FALLBACK =
	"Review the code changes against the base branch '{branch}'. Start by finding the merge diff between the current branch and {branch}'s upstream (e.g. `git merge-base HEAD \"$(git rev-parse --abbrev-ref \"{branch}@{upstream}\")\"`), then run `git diff` against that SHA to see what changes we would merge into the {branch} branch. Provide prioritized, actionable findings.";

const COMMIT_PROMPT_WITH_TITLE =
	'Review the code changes introduced by commit {sha} ("{title}"). Provide prioritized, actionable findings.';

const COMMIT_PROMPT =
	"Review the code changes introduced by commit {sha}. Provide prioritized, actionable findings.";

const PR_PROMPT_WITH_MB =
	'Review pull request #{prNumber} ("{title}") against the base branch \'{baseBranch}\'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes that would be merged. Provide prioritized, actionable findings.';

const PR_PROMPT_FALLBACK =
	'Review pull request #{prNumber} ("{title}") against the base branch \'{baseBranch}\'. Start by finding the merge base between the current branch and {baseBranch} (e.g., `git merge-base HEAD {baseBranch}`), then run `git diff` against that SHA to see the changes that would be merged. Provide prioritized, actionable findings.';

export async function buildReviewPrompt(pi: ExtensionAPI, target: ReviewTarget): Promise<string> {
	switch (target.type) {
		case "uncommitted":
			return UNCOMMITTED_PROMPT;
		case "baseBranch": {
			const mb = await getMergeBase(pi, target.branch);
			const base = mb
				? BASE_BRANCH_PROMPT_WITH_MB.replace(/{baseBranch}/g, target.branch).replace(
						/{mergeBaseSha}/g,
						mb,
					)
				: BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
			return `${base} ${LOCAL_CHANGES_REVIEW_INSTRUCTIONS}`;
		}
		case "commit":
			return target.title
				? COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace("{title}", target.title)
				: COMMIT_PROMPT.replace("{sha}", target.sha);
		case "pullRequest": {
			const mb = await getMergeBase(pi, target.baseBranch);
			return mb
				? PR_PROMPT_WITH_MB.replace(/{prNumber}/g, String(target.prNumber))
						.replace(/{title}/g, target.title)
						.replace(/{baseBranch}/g, target.baseBranch)
						.replace(/{mergeBaseSha}/g, mb)
				: PR_PROMPT_FALLBACK.replace(/{prNumber}/g, String(target.prNumber))
						.replace(/{title}/g, target.title)
						.replace(/{baseBranch}/g, target.baseBranch);
		}
	}
}
