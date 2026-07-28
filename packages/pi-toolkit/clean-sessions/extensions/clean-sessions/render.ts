/**
 * pi-toolkit-clean-sessions — render
 *
 * Plain-string formatters for the candidate list and confirm prompts.
 * No TUI dependencies.
 */

import type { SessionCandidate } from "./types";

const DISPLAY_TEXT_WIDTH = 48;
const DISPLAY_TEXT_TRUNCATED_WIDTH = 45;

// ---------------------------------------------------------------------------
// Candidate table
// ---------------------------------------------------------------------------

/**
 * Render a table of cleanup candidates.
 */
export function renderCandidateTable(candidates: SessionCandidate[]): string {
	const lines: string[] = [];
	const header = `  ${"Age".padEnd(6)}${"Lines".padEnd(8)}${"Name / ID".padEnd(50)}`;
	const separator = `  ${"-".repeat(6)}${"-".repeat(8)}${"-".repeat(50)}`;

	lines.push(header);
	lines.push(separator);

	for (const c of candidates) {
		const age = `${c.ageDays ?? "?"}d`.padEnd(6);
		const lineCount = String(c.lineCount).padEnd(8);
		const display = formatDisplay(c);

		lines.push(`  ${age}${lineCount}${display}`);
	}

	return lines.join("\n");
}

/**
 * Render the summary header shown before the candidate table.
 */
export function renderCandidateList(
	candidates: SessionCandidate[],
	olderThanDays: number,
	minLines: number,
): string {
	const sessionLabel = candidates.length === 1 ? "session" : "sessions";
	const table = renderCandidateTable(candidates);

	return [
		`Found ${candidates.length} ${sessionLabel} to clean:`,
		"",
		table,
		"",
		`Criteria: older than ${olderThanDays}d, fewer than ${minLines} lines, auto-named or unnamed.`,
		"Manually-named sessions (no date prefix) are always preserved.",
	].join("\n");
}

/**
 * Render the exact-count confirmation prompt.
 */
export function renderConfirmPrompt(count: number, action: string): string {
	return `Type "${count}" to ${action}, or anything else to cancel`;
}

// ---------------------------------------------------------------------------
// Result messages
// ---------------------------------------------------------------------------

export function renderCleanupResult(trashed: number, failed: number): string {
	const label = trashed === 1 ? "session" : "sessions";
	const suffix = failed > 0 ? ` ${failed} failed.` : "";
	return `Moved ${trashed} ${label} to .trash.${suffix} Use /empty-session-trash to permanently delete.`;
}

export function renderTrashContents(fileCount: number): string {
	const label = fileCount === 1 ? "file" : "files";
	return `Session trash contains ${fileCount} ${label}.`;
}

export function renderTrashDeletionResult(deleted: number): string {
	const label = deleted === 1 ? "session" : "sessions";
	return `Permanently deleted ${deleted} ${label} from trash.`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatDisplay(c: SessionCandidate): string {
	if (c.name) {
		if (c.name.length > DISPLAY_TEXT_WIDTH) {
			return `${c.name.slice(0, DISPLAY_TEXT_TRUNCATED_WIDTH)}...`;
		}
		return c.name;
	}

	// Fall back to the file path's last segment.
	const segments = c.path.split("/");
	const last = segments[segments.length - 1] ?? c.path;
	if (last.length > DISPLAY_TEXT_WIDTH) {
		return `...${last.slice(-DISPLAY_TEXT_TRUNCATED_WIDTH)}`;
	}
	return last;
}
