/**
 * pi-toolkit-find-session — types
 *
 * Pure type definitions. No runtime, no side effects.
 */

/** A single parsed `rg --json` match event. */
export interface RgMatchLine {
	/** Absolute path of the file containing the match. */
	filePath: string;
	/** 1-indexed line number of the match. */
	lineNumber: number;
	/** The matched line text, trimmed to a sane preview width. */
	matchedText: string;
	/** Best-effort project label, derived from the file path. */
	projectLabel: string;
}

/** A session grouped by file, with the first match used as the preview. */
export interface SessionMatch {
	filePath: string;
	projectLabel: string;
	firstMatch: RgMatchLine;
	/** Total number of matches rg found in this file. */
	matchCount: number;
}

/** Returned by the TUI when the user presses Enter. */
export interface FindSessionSelection {
	filePath: string;
}

import type { Theme } from "@earendil-works/pi-coding-agent";

/** Options for constructing the TUI component. */
export interface FindSessionComponentOptions {
	tui: { requestRender(): void };
	theme: Theme;
	onDone: (selection: FindSessionSelection | null) => void;
}
