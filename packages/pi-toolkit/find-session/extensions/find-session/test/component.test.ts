/**
 * component.test.ts
 *
 * TUI component render snapshots + input handling. No real TUI —
 * pass a fake tui.requestRender. Capture onDone calls.
 */

import { describe, expect, it, vi } from "vitest";
import { FindSessionComponent } from '../component';
import type { FindSessionComponentOptions, SessionMatch } from '../types';

function makeTheme(): FindSessionComponentOptions['theme'] {
	const passthrough = (_: string, text: string) => text;
	return {
		fg: passthrough,
		bg: passthrough,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		inverse: (text: string) => text,
		strikethrough: (text: string) => text,
		getFgAnsi: () => '',
		getBgAnsi: () => '',
		getColorMode: () => 'truecolor' as const,
		getThinkingBorderColor: () => (text: string) => text,
		getBashModeBorderColor: () => (text: string) => text,
	} as unknown as FindSessionComponentOptions['theme'];
}

function makeMatch(overrides: Partial<SessionMatch> = {}): SessionMatch {
	return {
		filePath: "/home/user/.pi/agent/sessions/project-x/2026-01-15-abc.jsonl",
		projectLabel: "project-x",
		firstMatch: {
			filePath: "/home/user/.pi/agent/sessions/project-x/2026-01-15-abc.jsonl",
			lineNumber: 42,
			matchedText: "auth rate limiter middleware",
			projectLabel: "project-x",
		},
		matchCount: 1,
		...overrides,
	};
}

function makeComponent(
	overrides: Partial<FindSessionComponentOptions> = {},
): { component: FindSessionComponent; onDone: ReturnType<typeof vi.fn>; requestRender: ReturnType<typeof vi.fn> } {
	const onDone = vi.fn();
	const requestRender = vi.fn();
	const component = new FindSessionComponent({
		tui: { requestRender },
		theme: makeTheme(),
		onDone,
		...overrides,
	});
	return { component, onDone, requestRender };
}

describe("FindSessionComponent — render", () => {
	it("renders loading state initially", () => {
		const { component } = makeComponent();
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("find-session");
		expect(lines.join("\n")).toContain("Searching");
	});

	it("renders empty state after setMatches([])", () => {
		const { component } = makeComponent();
		component.setMatches([]);
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("No sessions match");
	});

	it("renders error state after setError(...)", () => {
		const { component } = makeComponent();
		component.setError("rg timed out");
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("Error: rg timed out");
	});

	it("renders results with the first match as preview", () => {
		const { component } = makeComponent();
		component.setMatches([makeMatch()]);
		const lines = component.render(80);
		const text = lines.join("\n");
		expect(text).toContain("project-x");
		expect(text).toContain("auth rate limiter middleware");
	});

	it("renders the match count in status bar", () => {
		const { component } = makeComponent();
		component.setMatches([makeMatch(), makeMatch({ filePath: "/other.jsonl" })]);
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("2 matches");
	});

	it("renders '1 match' (singular) for a single result", () => {
		const { component } = makeComponent();
		component.setMatches([makeMatch()]);
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("1 match");
	});

	it("indicates additional matches when matchCount > 1", () => {
		const { component } = makeComponent();
		component.setMatches([makeMatch({ matchCount: 5 })]);
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("+4 more");
	});
});

describe("FindSessionComponent — input", () => {
	it("calls onDone(null) on Esc", () => {
		const { component, onDone } = makeComponent();
		component.setMatches([makeMatch()]);
		component.handleInput("\x1b");
		expect(onDone).toHaveBeenCalledWith(null);
	});

	it("calls onDone({ filePath }) on Enter with selected match", () => {
		const { component, onDone } = makeComponent();
		const m = makeMatch();
		component.setMatches([m]);
		component.handleInput("\r");
		expect(onDone).toHaveBeenCalledWith({ filePath: m.filePath });
	});

	it("calls onDone(null) on Enter when no matches", () => {
		const { component, onDone } = makeComponent();
		component.setMatches([]);
		component.handleInput("\r");
		expect(onDone).toHaveBeenCalledWith(null);
	});

	it("Down arrow moves selection down", () => {
		const { component, requestRender } = makeComponent();
		component.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		component.handleInput("\x1b[B");
		expect(requestRender).toHaveBeenCalled();
		// Verify selection moved by checking that Enter picks the second match.
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c2 = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c2.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		c2.handleInput("\x1b[B");
		c2.handleInput("\r");
		expect(onDoneCalls[0]).toEqual({ filePath: "/b.jsonl" });
	});

	it("Up arrow at top stays at 0", () => {
		const { component: _c, onDone: _od } = makeComponent();
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c2 = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c2.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		c2.handleInput("\x1b[A"); // Up at top
		c2.handleInput("\r");
		expect(onDoneCalls[0]).toEqual({ filePath: makeMatch().filePath });
	});

	it("clamps Down at the last match", () => {
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		c.handleInput("\x1b[B");
		c.handleInput("\x1b[B"); // try to go past
		c.handleInput("\r");
		expect(onDoneCalls[0]).toEqual({ filePath: "/b.jsonl" });
	});

	it("'j' and 'k' move selection like Down/Up (vim-style)", () => {
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		c.handleInput("j");
		c.handleInput("\r");
		expect(onDoneCalls[0]).toEqual({ filePath: "/b.jsonl" });
	});

	it("'g' jumps to top, 'G' jumps to bottom", () => {
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c.setMatches([
			makeMatch(),
			makeMatch({ filePath: "/b.jsonl" }),
			makeMatch({ filePath: "/c.jsonl" }),
		]);
		c.handleInput("G");
		c.handleInput("\r");
		expect(onDoneCalls[0]?.filePath).toBe("/c.jsonl");
		c.handleInput("g");
		c.handleInput("\r");
		expect(onDoneCalls[1]?.filePath).toBe(makeMatch().filePath);
	});

	it("setMatches resets selection to 0", () => {
		const onDoneCalls: Array<{ filePath: string } | null> = [];
		const c = new FindSessionComponent({
			tui: { requestRender: vi.fn() },
			theme: makeTheme(),
			onDone: (sel) => onDoneCalls.push(sel),
		});
		c.setMatches([makeMatch(), makeMatch({ filePath: "/b.jsonl" })]);
		c.handleInput("j");
		c.setMatches([makeMatch({ filePath: "/only.jsonl" })]);
		c.handleInput("\r");
		expect(onDoneCalls[0]?.filePath).toBe("/only.jsonl");
	});
});

describe("FindSessionComponent — focus lifecycle", () => {
	it("focus() and blur() toggle focused state", () => {
		const { component } = makeComponent();
		component.focus();
		component.blur();
		// Smoke test: render still works.
		expect(() => component.render(80)).not.toThrow();
	});
});
