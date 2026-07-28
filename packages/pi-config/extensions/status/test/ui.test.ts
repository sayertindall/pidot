/**
 * status/test/ui.test.ts
 *
 * Pure renderer tests. No fs, no pi. Verifies the status line format,
 * token formatting, context percentage thresholding, and width-fit
 * truncation.
 */
import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderStatusLine } from "../ui";
import type { StatusSnapshot } from "../types";

function makeTheme(): Theme {
	return {
		fg: (_color: string, text: string): string => text,
		// minimal shape — renderStatusLine only uses fg
	} as unknown as Theme;
}

function makeSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
	return {
		provider: "anthropic",
		model: "claude-sonnet-4",
		modelId: "claude-sonnet-4",
		thinkingLevel: "low",
		inputTokens: 12_300,
		outputTokens: 2_100,
		cost: 0.041,
		contextTokens: 45_000,
		contextWindow: 200_000,
		sessionShortId: "019f9f22",
		gitBranch: "main",
		...overrides,
	};
}

describe("renderStatusLine", () => {
	it("includes the model, thinking level, and session short id", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(makeSnapshot(), 200, theme);
		expect(lines).toHaveLength(1);
		const line = lines[0]!;
		expect(line).toContain("claude-sonnet-4");
		expect(line).toContain("think:low");
		expect(line).toContain("019f9f22");
	});

	it("includes the git branch when present", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(makeSnapshot({ gitBranch: "feature/x" }), 200, theme);
		expect(lines[0]).toContain("feature/x");
	});

	it("omits the branch when null", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(makeSnapshot({ gitBranch: null }), 200, theme);
		expect(lines[0]).not.toContain("(");
	});

	it("formats small token counts without suffix", () => {
		const snap = makeSnapshot({ inputTokens: 500, outputTokens: 100 });
		const theme = makeTheme();
		const lines = renderStatusLine(snap, 200, theme);
		expect(lines[0]).toContain("↑500");
		expect(lines[0]).toContain("↓100");
	});

	it("formats k and M suffixes correctly", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(
			makeSnapshot({ inputTokens: 12_345, outputTokens: 2_100_000 }),
			200,
			theme,
		);
		expect(lines[0]).toContain("12.3k");
		expect(lines[0]).toContain("2.1M");
	});

	it("truncates the right side when the line is too wide", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(makeSnapshot(), 30, theme);
		expect(lines[0]!.length).toBeLessThanOrEqual(31);
	});

	it("shows ctx — when no context window is configured", () => {
		const theme = makeTheme();
		const lines = renderStatusLine(makeSnapshot({ contextWindow: 0, contextTokens: 0 }), 200, theme);
		expect(lines[0]).toContain("ctx —");
	});
});
