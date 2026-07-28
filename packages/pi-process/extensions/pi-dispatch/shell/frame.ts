/**
 * shell/frame.ts
 *
 * Pure overlay rendering: ViewModel -> string[]. No pi-tui imports and no
 * side effects (PI-DISPATCH-SPEC.md -- this is the file a test suite
 * asserts against with fixture data, not a live TUI), so width/truncation
 * math is done locally here instead of borrowing pi-tui's
 * truncateToWidth/visibleWidth. Chrome (borders, header, footer) is plain
 * text; only the PTY viewport content carries embedded SGR, produced by
 * runtime's getViewportLines({ ansi: true }).
 */
import {
	type DialogChoice,
	FOOTER_LINES_COMPACT,
	FOOTER_LINES_DIALOG,
	formatDuration,
	formatShortcut,
	HEADER_LINES,
	type OverlayState,
} from "./types";

export interface DialogOption {
	key: DialogChoice;
	label: string;
}

/**
 * Standard detach-dialog choices. No "return-to-agent": that choice only
 * applies to a hands-free user-takeover flow this overlay doesn't track
 * (interactive-mode LiveSession has no takeover state). DialogChoice stays
 * a superset so other callers (e.g. a hands-free supervisor) can still use
 * the same union.
 */
export const DIALOG_OPTIONS = [
	{ key: "transfer", label: "Transfer output to agent" },
	{ key: "background", label: "Run in background" },
	{ key: "kill", label: "Kill process" },
	{ key: "cancel", label: "Cancel (return to session)" },
] as const satisfies readonly DialogOption[];

export interface ViewModel {
	sessionId: string;
	command: string;
	reason?: string;
	pid: number;
	focused: boolean;
	state: OverlayState;
	elapsedMs: number;
	width: number;
	viewportLines: string[];
	isScrolledUp: boolean;
	exitCode: number | null;
	/** Present only when state === "exited". */
	exitCountdownSeconds?: number;
	focusShortcut: string;
	/** Present only when state === "detach-dialog". */
	dialogSelection?: DialogChoice;
}

interface BorderGlyphs {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
	separatorLeft: string;
	separatorRight: string;
}

const FOCUSED_GLYPHS: BorderGlyphs = {
	topLeft: "╔",
	topRight: "╗",
	bottomLeft: "╚",
	bottomRight: "╝",
	horizontal: "═",
	vertical: "║",
	separatorLeft: "╠",
	separatorRight: "╣",
};

const UNFOCUSED_GLYPHS: BorderGlyphs = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
	separatorLeft: "├",
	separatorRight: "┤",
};

const ANSI_SGR = /^\x1b\[[0-9;]*m/;

function visibleWidth(s: string): number {
	let width = 0;
	let i = 0;
	while (i < s.length) {
		const match = ANSI_SGR.exec(s.slice(i));
		if (match) {
			i += match[0].length;
			continue;
		}
		width += 1;
		i += 1;
	}
	return width;
}

function truncateToWidth(s: string, width: number): string {
	if (width <= 0) return "";
	let out = "";
	let visible = 0;
	let i = 0;
	while (i < s.length) {
		const match = ANSI_SGR.exec(s.slice(i));
		if (match) {
			out += match[0];
			i += match[0].length;
			continue;
		}
		if (visible >= width) break;
		out += s[i];
		visible += 1;
		i += 1;
	}
	return out;
}

function pad(s: string, width: number): string {
	const w = visibleWidth(s);
	return w >= width ? s : s + " ".repeat(width - w);
}

function row(content: string, innerWidth: number, glyphs: BorderGlyphs): string {
	return `${glyphs.vertical} ${pad(truncateToWidth(content, innerWidth), innerWidth)} ${glyphs.vertical}`;
}

function horizontalLine(width: number, left: string, right: string, glyphs: BorderGlyphs): string {
	return left + glyphs.horizontal.repeat(Math.max(0, width - 2)) + right;
}

/** Exit-state check mark / cross, or a plain running dot. Kept plain (no
 * color) so this stays testable against fixture strings -- overlay.ts owns
 * any additional styling of the rendered lines. */
export function statusDot(vm: Pick<ViewModel, "state" | "exitCode">): string {
	if (vm.state === "exited") return vm.exitCode === 0 ? "✓" : "✗";
	return "●";
}

function glyphsFor(vm: Pick<ViewModel, "focused">): BorderGlyphs {
	return vm.focused ? FOCUSED_GLYPHS : UNFOCUSED_GLYPHS;
}

/** Footer row count for a given overlay state, per types's constants. */
export function footerLineCount(state: OverlayState): number {
	return state === "detach-dialog" ? FOOTER_LINES_DIALOG : FOOTER_LINES_COMPACT;
}

/**
 * Rows available for the PTY viewport once header, footer, and border
 * chrome are subtracted from the overlay's total row budget. Callers
 * resize runtime's PtyRuntime to this before calling getViewportLines.
 */
export function computeTerminalRows(overlayHeightRows: number, state: OverlayState): number {
	const chrome = HEADER_LINES + footerLineCount(state) + 2;
	return Math.max(0, overlayHeightRows - chrome);
}

function buildHeaderLines(vm: ViewModel, width: number, innerWidth: number, glyphs: BorderGlyphs): string[] {
	const lines: string[] = [];
	lines.push(horizontalLine(width, glyphs.topLeft, glyphs.topRight, glyphs));

	const sanitizedCommand = vm.command.replace(/\s+/g, " ").trim();
	const meta = `PID: ${vm.pid}`;
	const title = truncateToWidth(sanitizedCommand, Math.max(0, innerWidth - visibleWidth(meta) - 1));
	const gap = " ".repeat(Math.max(0, innerWidth - visibleWidth(title) - visibleWidth(meta)));
	lines.push(row(`${title}${gap}${meta}`, innerWidth, glyphs));

	const sanitizedReason = vm.reason?.replace(/\s+/g, " ").trim();
	const duration = formatDuration(vm.elapsedMs);
	const hint = sanitizedReason
		? `${statusDot(vm)} ${duration} • ${sanitizedReason}`
		: `${statusDot(vm)} ${duration}`;
	lines.push(row(hint, innerWidth, glyphs));

	lines.push(horizontalLine(width, glyphs.separatorLeft, glyphs.separatorRight, glyphs));
	return lines;
}

function buildMiddleSeparator(vm: ViewModel, width: number, glyphs: BorderGlyphs): string {
	if (!vm.isScrolledUp) {
		return horizontalLine(width, glyphs.separatorLeft, glyphs.separatorRight, glyphs);
	}
	const hintText = "── scrolled up (Shift+Down) ──";
	const innerWidth = Math.max(0, width - 2);
	const padLen = Math.max(0, Math.floor((innerWidth - hintText.length) / 2));
	const line = " ".repeat(padLen) + hintText + " ".repeat(Math.max(0, innerWidth - padLen - hintText.length));
	return glyphs.separatorLeft + line + glyphs.separatorRight;
}

function padFooter(lines: string[], target: number, innerWidth: number, glyphs: BorderGlyphs): string[] {
	const out = lines.slice(0, target);
	while (out.length < target) {
		out.push(row("", innerWidth, glyphs));
	}
	return out;
}

function buildFooterLines(vm: ViewModel, innerWidth: number, glyphs: BorderGlyphs): string[] {
	const focusHint = `${formatShortcut(vm.focusShortcut)} ${vm.focused ? "unfocus" : "focus shell"}`;

	if (vm.state === "detach-dialog") {
		const lines = [row("Session actions:", innerWidth, glyphs)];
		for (const opt of DIALOG_OPTIONS) {
			const selected = vm.dialogSelection === opt.key;
			lines.push(row((selected ? "▶ " : "  ") + opt.label, innerWidth, glyphs));
		}
		lines.push(row("↑↓ select • Enter confirm • Esc cancel", innerWidth, glyphs));
		return padFooter(lines, FOOTER_LINES_DIALOG, innerWidth, glyphs);
	}

	if (vm.state === "exited") {
		const exitMsg = vm.exitCode === 0 ? "Exited successfully" : `Exited with code ${vm.exitCode}`;
		const countdown = vm.exitCountdownSeconds ?? 0;
		return padFooter(
			[
				row(exitMsg, innerWidth, glyphs),
				row(`Closing in ${countdown}s... (any key to close) • ${focusHint}`, innerWidth, glyphs),
			],
			FOOTER_LINES_COMPACT,
			innerWidth,
			glyphs,
		);
	}

	const runningHint = vm.focused
		? `Ctrl+T transfer • Ctrl+B background • Ctrl+Q menu • Shift+Up/Down scroll • ${focusHint}`
		: focusHint;
	return padFooter([row(runningHint, innerWidth, glyphs)], FOOTER_LINES_COMPACT, innerWidth, glyphs);
}

/** Header chrome only (4 lines, per HEADER_LINES). Exported standalone for
 * unit tests that don't want to fabricate a full ViewModel's viewport. */
export function renderHeaderLines(vm: ViewModel): string[] {
	const width = Math.max(4, vm.width);
	const innerWidth = width - 4;
	return buildHeaderLines(vm, width, innerWidth, glyphsFor(vm));
}

/** Footer chrome only, sized to footerLineCount(vm.state). */
export function renderFooterLines(vm: ViewModel): string[] {
	const width = Math.max(4, vm.width);
	const innerWidth = width - 4;
	return buildFooterLines(vm, innerWidth, glyphsFor(vm));
}

/** Full overlay frame: header + PTY viewport rows + footer, bordered. */
export function renderOverlayFrame(vm: ViewModel): string[] {
	const width = Math.max(4, vm.width);
	const innerWidth = width - 4;
	const glyphs = glyphsFor(vm);

	const lines = buildHeaderLines(vm, width, innerWidth, glyphs);
	for (const line of vm.viewportLines) {
		lines.push(row(line, innerWidth, glyphs));
	}
	lines.push(buildMiddleSeparator(vm, width, glyphs));
	lines.push(...buildFooterLines(vm, innerWidth, glyphs));
	lines.push(horizontalLine(width, glyphs.bottomLeft, glyphs.bottomRight, glyphs));
	return lines;
}
