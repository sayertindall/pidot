import { complete } from "@earendil-works/pi-ai/compat";
import {
	BorderedLoader,
	DynamicBorder,
	getMarkdownTheme,
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	Markdown,
	Text,
	matchesKey,
	type TUI,
} from "@earendil-works/pi-tui";
import { digestSession } from "./extract";
import { buildAnalysisPrompt, buildCrossSessionOverlap, COACH_SYSTEM_PROMPT } from "./prompt";
import { openSession } from "./scope";
import { CoachModePicker } from "./selector";
import type { CoachScope, SavedCoachReport, SessionDigest } from "./types";

const COACH_REPORT_ENTRY = "coach-report-state";
const COACH_REPORT_MESSAGE = "coach-report";

export async function collectAndAnalyze(
	ctx: ExtensionCommandContext,
	scope: CoachScope,
	signal?: AbortSignal,
): Promise<string> {
	const cwd = ctx.cwd;
	const usage = ctx.getContextUsage();
	const contextTokens = typeof usage?.tokens === "number" ? usage.tokens : undefined;
	const contextWindow = typeof usage?.contextWindow === "number" ? usage.contextWindow : undefined;
	const contextPercent =
		contextTokens !== undefined && contextWindow !== undefined && contextWindow > 0
			? (contextTokens / contextWindow) * 100
			: undefined;

	let digests: SessionDigest[];
	let currentDigest: SessionDigest;

	if (scope === "current") {
		const entries = ctx.sessionManager.getBranch();
		currentDigest = digestSession(entries, cwd);
		currentDigest.name = ctx.sessionManager.getSessionName() ?? undefined;
		digests = [currentDigest];
	} else {
		const sessions = await SessionManager.list(cwd, ctx.sessionManager.getSessionDir());
		sessions.sort((a, b) => b.created.getTime() - a.created.getTime());

		digests = [];
		for (const session of sessions) {
			try {
				const manager = openSession(session.path);
				digests.push(digestSession(manager.getBranch(), cwd, session));
			} catch {
				// Skip unreadable sessions.
			}
		}

		const currentBranch = ctx.sessionManager.getBranch();
		currentDigest = digestSession(currentBranch, cwd);
		currentDigest.name = ctx.sessionManager.getSessionName() ?? undefined;
	}

	const overlap = buildCrossSessionOverlap(digests);
	const prompt = buildAnalysisPrompt(digests, overlap, currentDigest, contextPercent, contextTokens, contextWindow);

	const model = ctx.model;
	if (!model) {
		throw new Error("No active model. Select a model first.");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Cannot get API key: ${auth.error}`);
	}

	const messages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: prompt }],
			timestamp: Date.now(),
		},
	];

	const response = await complete(
		model,
		{ systemPrompt: COACH_SYSTEM_PROMPT, messages },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal,
			reasoningEffort: "high",
		},
	);

	if (response.stopReason === "error") {
		throw new Error(`Analysis failed: ${response.errorMessage ?? "Unknown error"}`);
	}

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

export function saveCoachReport(pi: ExtensionAPI, scope: CoachScope, markdown: string): void {
	pi.appendEntry<SavedCoachReport>(COACH_REPORT_ENTRY, {
		markdown,
		scope,
		createdAt: new Date().toISOString(),
	});
}

export function getLastCoachReport(ctx: ExtensionCommandContext): SavedCoachReport | null {
	const branchEntries = ctx.sessionManager.getBranch();

	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry?.type !== "custom" || entry.customType !== COACH_REPORT_ENTRY) continue;

		const data = entry.data as SavedCoachReport | undefined;
		if (!data?.markdown) continue;

		return {
			markdown: data.markdown,
			scope: data.scope === "current" ? "current" : "all",
			createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
		};
	}

	return null;
}

export function sendCoachMessage(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({ customType: COACH_REPORT_MESSAGE, content, display: true }, { triggerTurn: false });
}

export function presentCoachNotice(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	message: string,
	level: "info" | "warning" | "error" = "warning",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	sendCoachMessage(pi, message);
}

export function getCoachLoadingMessage(scope: CoachScope): string {
	if (scope === "current") {
		return "Reading session content and sending to model for analysis...";
	}

	return "Opening all sessions, reading content, and sending to model for deep analysis...";
}

export async function presentCoachReport(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	markdown: string,
): Promise<void> {
	if (!ctx.hasUI) {
		sendCoachMessage(pi, markdown);
		return;
	}

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const mdTheme = getMarkdownTheme();
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(
			new Text(
				theme.fg("accent", theme.bold("Coach Analysis")) + theme.fg("dim", "  (Esc/q/Enter to close)"),
				1,
				0,
			),
		);
		container.addChild(new Text("", 1, 0));
		container.addChild(new Markdown(markdown, 1, 0, mdTheme));
		container.addChild(new Text("", 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (
					matchesKey(data, Key.escape) ||
					matchesKey(data, Key.ctrl("c")) ||
					matchesKey(data, Key.enter) ||
					data.toLowerCase() === "q"
				) {
					done(undefined);
				}
			},
		};
	});
}

export async function handleCoach(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const action = args.trim().toLowerCase();

	switch (action) {
		case "last": {
			const savedReport = getLastCoachReport(ctx);
			if (!savedReport) {
				presentCoachNotice(pi, ctx, 'No saved coach report in this session yet. Run "/coach" first.');
				return;
			}

			await presentCoachReport(pi, ctx, savedReport.markdown);
			return;
		}
		case "":
			break;
		default:
			presentCoachNotice(pi, ctx, "Usage: /coach or /coach last");
			return;
	}

	if (!ctx.hasUI) {
		presentCoachNotice(pi, ctx, "Coach requires interactive mode", "error");
		return;
	}

	if (!ctx.model) {
		presentCoachNotice(pi, ctx, "No model selected", "error");
		return;
	}

	let scope: CoachScope = "all";

	const selectedScope = await ctx.ui.custom<CoachScope | null>(
		(tui: TUI, theme, _kb, done) => new CoachModePicker(tui, theme, done),
	);
	if (!selectedScope) return;
	scope = selectedScope;

	const loadingMessage = getCoachLoadingMessage(scope);

	const analysisMarkdown = await ctx.ui.custom<string | null>((tui: TUI, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, loadingMessage);
		loader.onAbort = () => done(null);

		collectAndAnalyze(ctx, scope, loader.signal)
			.then((result) => done(result))
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Coach failed: ${message}`, "error");
				done(null);
			});

		return loader;
	});

	if (!analysisMarkdown) return;

	saveCoachReport(pi, scope, analysisMarkdown);
	await presentCoachReport(pi, ctx, analysisMarkdown);
}
