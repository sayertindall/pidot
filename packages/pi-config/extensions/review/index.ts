/**
 * review/index.ts
 *
 * Code review in a fresh session branch. Lifecycle:
 *   idle → launching → running → done | failed | cancelled
 *
 * Persistent state (session-scoped, base64url session id):
 *   ~/.pi/agent/pi-config/review/<base64url(sessionId)>/state.json
 *
 * On completion, posts one hidden follow-up bundle to the main session
 * rather than per-file summaries.
 *
 * Principle mapping:
 *   1 TypeBox     — schemas.ts
 *   2 markdown    — review-guidelines.md + REVIEW_GUIDELINES.md discovery
 *   3 session     — base64url(sessionId) subdir
 *   4 widget      — single setWidget below
 *   5 debounce    — ReviewStore: lifecycle eager, activity debounced 1s
 *   6 throw/warn  — N/A
 *   7 split       — types/schemas/state/runtime/ui/commands/selectors/targets as own files
 *   8 ns          — /review
 *   9 schemas.ts  — present with full ReviewStateSchema
 */
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { HELP_TEXT, parseReviewArgs } from "./commands";
import {
	buildReviewPrompt,
	loadDefaultRubric,
	loadReviewGuidelines,
} from "./runtime";
import { selectTargetInteractive } from "./selectors";
import { ReviewStore, readState } from "./state";
import {
	getPrInfo,
	getUserFacingHint,
	hasPendingChanges,
	parsePrReference,
} from "./targets";
import { renderReviewWidget } from "./ui";
import type { ReviewRecord, ReviewTarget } from "./types";
import { checkoutPr } from "./targets";

const WIDGET_KEY = "review";

export default function reviewExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		// Touch state so future reads see the same store, then refresh widget.
		const store = getStore(ctx);
		refreshWidget(store, ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	pi.registerCommand("review", {
		description: "Review code changes (uncommitted, branch, commit, or PR). Usage: /review <subcommand>",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Review requires interactive mode", "error");
				return;
			}

			const parsed = parseReviewArgs(args);

			// status / cancel / help don't need a git repo
			if (parsed.kind === "status") return handleStatus(ctx);
			if (parsed.kind === "cancel") return handleCancel(ctx);
			if (parsed.kind === "help") {
				ctx.ui.notify(HELP_TEXT, "info");
				return;
			}

			// All other subcommands need a git repo.
			const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
			if (code !== 0) {
				ctx.ui.notify("Not a git repository", "error");
				return;
			}

			let target: ReviewTarget | null = null;
			let extraInstruction: string | undefined;
			switch (parsed.kind) {
				case "uncommitted":
					target = { type: "uncommitted" };
					extraInstruction = parsed.extra;
					break;
				case "branch":
					target = { type: "baseBranch", branch: parsed.branch };
					extraInstruction = parsed.extra;
					break;
				case "commit":
					target = { type: "commit", sha: parsed.sha, title: parsed.title };
					extraInstruction = parsed.extra;
					break;
				case "pr": {
					const prNumber = parsePrReference(parsed.ref);
					if (!prNumber) {
						ctx.ui.notify("Invalid PR reference. Enter a number or GitHub PR URL.", "error");
						return;
					}
					const prInfo = await getPrInfo(pi, prNumber);
					if (!prInfo) {
						ctx.ui.notify(`Could not find PR #${prNumber}.`, "error");
						return;
					}
					if (await hasPendingChanges(pi)) {
						ctx.ui.notify("Cannot checkout PR: you have uncommitted changes.", "error");
						return;
					}
					const checkout = await checkoutPr(pi, prNumber);
					if (!checkout.success) {
						ctx.ui.notify(`Failed to checkout PR: ${checkout.error ?? "unknown"}`, "error");
						return;
					}
					target = {
						type: "pullRequest",
						prNumber,
						baseBranch: prInfo.baseBranch,
						title: prInfo.title,
					};
					extraInstruction = parsed.extra;
					break;
				}
			}

			if (!target) {
				target = await selectTargetInteractive(pi, ctx as ExtensionCommandContext);
				if (!target) {
					ctx.ui.notify("Review cancelled", "info");
					return;
				}
			}

			await launchReview(pi, ctx, target, extraInstruction);
		},
	});

	pi.registerCommand("end-review", {
		description: "Finish review and return to the original position",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const store = getStore(ctx);
			const cur = store.get();
			if (!cur) {
				ctx.ui.notify("Not in a review branch (use /review first)", "info");
				return;
			}
			await store.transition({
				...cur,
				status: "done",
				finishedAt: Date.now(),
				updatedAt: Date.now(),
			});
			refreshWidget(store, ctx);
			ctx.ui.notify("Review complete.", "info");
		},
	});
}

// ── helpers ─────────────────────────────────────────────────────────

function sessionIdOf(ctx: ExtensionContext): string {
	const sm = ctx.sessionManager as unknown as { getSessionId?: () => string | undefined };
	if (typeof sm.getSessionId !== "function") return "default";
	const id = sm.getSessionId();
	return typeof id === "string" && id ? id : "default";
}

const storeCache = new WeakMap<ExtensionContext, ReviewStore>();

function getStore(ctx: ExtensionContext): ReviewStore {
	let s = storeCache.get(ctx);
	if (!s) {
		s = new ReviewStore(sessionIdOf(ctx));
		storeCache.set(ctx, s);
	}
	return s;
}

function refreshWidget(store: ReviewStore, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const record = store.get();
	if (!record) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		invalidate() {},
		render(): string[] {
			return renderReviewWidget(store.get(), Date.now(), theme);
		},
	}));
}

function handleStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const state = readState(sessionIdOf(ctx));
	const cur = state.current;
	if (!cur) {
		ctx.ui.notify("No active review.", "info");
		return;
	}
	ctx.ui.notify(
		`Review [${cur.status}] target=${getUserFacingHint(cur.target)} tools=${cur.toolCount} started=${new Date(cur.startedAt).toISOString()}`,
		"info",
	);
}

async function handleCancel(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	const store = getStore(ctx);
	const cur = store.get();
	if (!cur) {
		ctx.ui.notify("No active review.", "info");
		return;
	}
	await store.transition({
		...cur,
		status: "cancelled",
		finishedAt: Date.now(),
		updatedAt: Date.now(),
	});
	refreshWidget(store, ctx);
	ctx.ui.notify("Review cancelled.", "info");
}

async function launchReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	target: ReviewTarget,
	extraInstruction: string | undefined,
): Promise<void> {
	const store = getStore(ctx);
	if (store.get()) {
		ctx.ui.notify("A review is already in progress. Use /review cancel first.", "warning");
		return;
	}

	const now = Date.now();
	const record: ReviewRecord = {
		target,
		status: "launching",
		startedAt: now,
		updatedAt: now,
		toolCount: 0,
	};
	await store.transition(record);
	refreshWidget(store, ctx);

	const focus = await buildReviewPrompt(pi, target);
	const rubric = loadDefaultRubric();
	const guidelines = await loadReviewGuidelines(ctx.cwd);

	let fullPrompt = `${rubric}\n\n---\n\nPlease perform a code review with the following focus:\n\n${focus}`;
	if (guidelines) fullPrompt += `\n\nThis project has additional review guidelines:\n\n${guidelines}`;
	if (extraInstruction) fullPrompt += `\n\nAdditional user instruction:\n\n${extraInstruction}`;

	const hint = getUserFacingHint(target);
	if (ctx.hasUI) ctx.ui.notify(`Starting review: ${hint}`, "info");

	// Mark running before sending so the widget reflects state truthfully.
	const cur = store.get();
	if (cur) {
		await store.transition({ ...cur, status: "running" });
	}
	refreshWidget(store, ctx);

	pi.sendUserMessage(fullPrompt);
}
