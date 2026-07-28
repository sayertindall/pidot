/**
 * pi-toolkit-find-session — component
 *
 * Scrollable list TUI. Up/Down to move selection, PageUp/PageDown to
 * jump 10 rows, Enter to pick, Esc to cancel. Renders three states:
 * loading (no matches yet, no error), empty (search done, no results),
 * results (one or more matches).
 *
 * Implements Component + Focusable so it can be hosted in a `ctx.ui.custom`
 * overlay.
 */
import { basename } from "node:path";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FindSessionComponentOptions, SessionMatch } from "./types";

interface Component {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

interface Focusable {
	focus(): void;
	blur(): void;
}

type State = "loading" | "empty" | "error" | "results";

export class FindSessionComponent implements Component, Focusable {
	private matches: SessionMatch[] = [];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private error: string | null = null;
	private state: State = "loading";
	private cachedWidth: number | null = null;
	private cachedLines: string[] | null = null;

	constructor(private readonly options: FindSessionComponentOptions) {}

	/** Called by the factory when the search completes. */
	setMatches(matches: SessionMatch[]): void {
		this.matches = matches;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.state = matches.length === 0 ? "empty" : "results";
		this.error = null;
		this.invalidate();
		this.options.tui.requestRender();
	}

	/** Called by the factory when the search fails. */
	setError(message: string): void {
		this.error = message;
		this.state = "error";
		this.matches = [];
		this.invalidate();
		this.options.tui.requestRender();
	}

	focus(): void {
		this.invalidate();
		this.options.tui.requestRender();
	}

	blur(): void {
		this.invalidate();
		this.options.tui.requestRender();
	}

	invalidate(): void {
		this.cachedWidth = null;
		this.cachedLines = null;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onDone(null);
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const selected = this.matches[this.selectedIndex];
			this.options.onDone(selected ? { filePath: selected.filePath } : null);
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p")) || data === "k") {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n")) || data === "j") {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.moveSelection(-10);
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.moveSelection(10);
			return;
		}
		if (data === "g") {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			this.invalidate();
			this.options.tui.requestRender();
			return;
		}
		if (data === "G") {
			if (this.matches.length > 0) {
				this.selectedIndex = this.matches.length - 1;
			}
			this.invalidate();
			this.options.tui.requestRender();
			return;
		}
	}

	private moveSelection(delta: number): void {
		if (this.matches.length === 0) return;
		const next = this.selectedIndex + delta;
		this.selectedIndex = Math.max(0, Math.min(this.matches.length - 1, next));
		this.invalidate();
		this.options.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}
		const lines = this.renderFresh(width);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderFresh(width: number): string[] {
		const lines: string[] = [];
		const border = "─".repeat(Math.max(0, width - 2));
		const theme = this.options.theme;
		const title = theme.bold("find-session");
		const headerBorder = `┌${border}┐`;
		const footerBorder = `└${border}┘`;
		const sepBorder = `├${border}┤`;

		lines.push(this.padRow(headerBorder, width));
		lines.push(this.padRow(`│ ${title}`, width));

		if (this.state === "loading") {
			lines.push(this.padRow(`│ ${this.fg("dim", "Searching…")}`, width));
			lines.push(this.padRow(sepBorder, width));
			lines.push(this.padRow(`│ ${this.fg("dim", "Esc to cancel")}`, width));
			lines.push(this.padRow(footerBorder, width));
			return lines;
		}

		if (this.state === "error") {
			const errText = this.fg("error", `Error: ${this.error ?? "unknown"}`);
			lines.push(this.padRow(`│ ${errText}`, width));
			lines.push(this.padRow(sepBorder, width));
			lines.push(this.padRow(`│ ${this.fg("dim", "Esc to cancel")}`, width));
			lines.push(this.padRow(footerBorder, width));
			return lines;
		}

		if (this.state === "empty") {
			lines.push(this.padRow(`│ ${this.fg("dim", "No sessions match.")}`, width));
			lines.push(this.padRow(sepBorder, width));
			lines.push(this.padRow(`│ ${this.fg("dim", "Esc to cancel")}`, width));
			lines.push(this.padRow(footerBorder, width));
			return lines;
		}

		// results state
		const maxRows = Math.max(3, width >= 120 ? 18 : 12);
		this.scrollOffset = Math.max(0, Math.min(this.matches.length - maxRows, this.scrollOffset));
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		}
		if (this.selectedIndex >= this.scrollOffset + maxRows) {
			this.scrollOffset = this.selectedIndex - maxRows + 1;
		}
		this.scrollOffset = Math.max(0, Math.min(this.matches.length - maxRows, this.scrollOffset));
		const end = Math.min(this.matches.length, this.scrollOffset + maxRows);

		for (let i = this.scrollOffset; i < end; i++) {
			const match = this.matches[i];
			if (!match) continue;
			lines.push(this.renderMatchRow(match, width, i === this.selectedIndex));
		}

		const statusParts: string[] = [];
		statusParts.push(`${this.matches.length} match${this.matches.length === 1 ? "" : "es"}`);
		if (this.matches.length > maxRows) {
			statusParts.push(`${this.selectedIndex + 1}/${this.matches.length}`);
		}
		lines.push(this.padRow(sepBorder, width));
		const hint = `${statusParts.join(" · ")} · ↑↓ move · PgUp/PgDn jump · Enter resume · Esc cancel`;
		lines.push(this.padRow(`│ ${this.fg("dim", hint)}`, width));
		lines.push(this.padRow(footerBorder, width));
		return lines;
	}

	private renderMatchRow(match: SessionMatch, width: number, isSelected: boolean): string {
		const projectLabel = match.projectLabel.length > 24 ? `${match.projectLabel.slice(0, 23)}…` : match.projectLabel;
		const fileBase = basename(match.filePath, ".jsonl");
		const fileLabel = fileBase.length > 32 ? `${fileBase.slice(0, 31)}…` : fileBase;
		const preview = match.firstMatch.matchedText.replace(/\s+/g, " ").trim();
		const lineNum = String(match.firstMatch.lineNumber);
		const matchCountSuffix = match.matchCount > 1 ? ` (+${match.matchCount - 1} more)` : "";
		const header = `${projectLabel}  ${fileLabel}:${lineNum}${matchCountSuffix}`;
		const headerWithBullet = isSelected ? `▸ ${header}` : `  ${header}`;
		const previewLine = `  ${preview}`;

		const headerStyled = isSelected
			? this.fg("accent", headerWithBullet)
			: headerWithBullet;
		const previewStyled = this.fg("dim", previewLine);

		return this.padRow(`│ ${headerStyled}`, width) + "\n" + this.padRow(`│ ${previewStyled}`, width);
	}

	private padRow(row: string, width: number): string {
		const visible = row.replace(/\x1b\[[0-9;]*m/g, "");
		const pad = Math.max(0, width - visible.length);
		return row + " ".repeat(pad);
	}

	private fg(color: string, text: string): string {
		return this.options.theme.fg(color as Parameters<Theme["fg"]>[0], text);
	}
}
