/**
 * status/ui.ts
 *
 * Footer widget renderer. Builds a single-line status string from a
 * `StatusSnapshot`, fitting it to the available width. Truncation is
 * left-side (preserve the rightmost "freshest" stats: model + session id).
 *
 * Render-throttling: pi's `setFooter` only re-renders on its own schedule;
 * we just keep this function cheap.
 */
import type { StatusSnapshot } from "./types";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const STATIC_PREFIX = "● ";

function formatTokens(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatContextPct(snap: StatusSnapshot): { text: string; pct: number } {
	if (snap.contextWindow <= 0) return { text: "ctx —", pct: 0 };
	const pct = Math.min(100, Math.round((snap.contextTokens / snap.contextWindow) * 100));
	return { text: `ctx ${pct}%`, pct };
}

/** Strip ANSI escapes for visible-width measurement. */
function visibleLen(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Truncate a styled string from the left, preserving ANSI sequences. */
function truncLeft(s: string, maxVisible: number): string {
	const clean = s.replace(/\x1b\[[0-9;]*m/g, "");
	if (clean.length <= maxVisible) return s;
	const toRemove = clean.length - maxVisible + 1;
	let result = "";
	let i = 0;
	let removed = 0;
	while (i < s.length && removed < toRemove) {
		if (s[i] === "\x1b" && s[i + 1] === "[") {
			const end = s.indexOf("m", i);
			if (end === -1) break;
			result += s.slice(i, end + 1);
			i = end + 1;
		} else {
			i++;
			removed++;
		}
	}
	return `${result}…${s.slice(i)}`;
}

export function renderStatusLine(
	snap: StatusSnapshot,
	width: number,
	theme: Theme,
): string[] {
	const ctx = formatContextPct(snap);
	const ctxColor = (ctx.pct > 80 ? "error" : ctx.pct > 60 ? "warning" : "dim") as ThemeColor;

	const left = theme.fg(
		"dim" as ThemeColor,
		`${STATIC_PREFIX}↑${formatTokens(snap.inputTokens)} ↓${formatTokens(snap.outputTokens)} $${snap.cost.toFixed(3)}`,
	);
	const ctxPart = theme.fg(ctxColor, ctx.text);

	const rightParts = [
		theme.fg("dim" as ThemeColor, `think:${snap.thinkingLevel}`),
		theme.fg("accent" as ThemeColor, snap.modelId),
		theme.fg("dim" as ThemeColor, snap.sessionShortId),
	];
	if (snap.gitBranch) {
		rightParts.push(theme.fg("dim" as ThemeColor, `(${snap.gitBranch})`));
	}
	const right = rightParts.join(" ");

	const composed = `${left} ${ctxPart}`;
	const gap = Math.max(1, width - visibleLen(composed) - visibleLen(right));
	const line = `${composed}${" ".repeat(gap)}${right}`;
	if (visibleLen(line) <= width) return [line];

	const maxRight = Math.max(0, width - visibleLen(composed) - 2);
	return [`${composed} ${truncLeft(right, maxRight)}`];
}
