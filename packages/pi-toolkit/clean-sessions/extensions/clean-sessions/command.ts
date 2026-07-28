/**
 * pi-toolkit-clean-sessions — command
 *
 * Command handlers for /clean-sessions and /empty-session-trash.
 * These drive the UI flow: scan → render → confirm → execute → report.
 */

import { promises as fs } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	findCandidates,
	DEFAULT_DAYS,
	MIN_LINES,
	SESSIONS_DIR,
} from "./candidate";
import {
	renderCandidateList,
	renderCleanupResult,
	renderConfirmPrompt,
	renderTrashDeletionResult,
} from "./render";
import { emptyTrash, listTrash, moveToTrash } from "./trash";

// ============================================================================
// Helpers
// ============================================================================

function ensureInteractive(
	ctx: ExtensionCommandContext,
	commandName: string,
): boolean {
	if (ctx.hasUI) return true;
	ctx.ui.notify(`${commandName} requires an interactive session`, "error");
	return false;
}

async function confirmExactCount(
	ctx: ExtensionCommandContext,
	count: number,
	prompt: string,
	canceledMessage: string,
): Promise<boolean> {
	const input = await ctx.ui.input(prompt, "");
	if (input?.trim() === String(count)) return true;
	ctx.ui.notify(canceledMessage, "info");
	return false;
}

// ============================================================================
// /clean-sessions [days]
// ============================================================================

export async function handleCleanSessions(
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!ensureInteractive(ctx, "/clean-sessions")) return;

	// Parse optional days argument.
	const trimmed = args.trim();
	let olderThanDays = DEFAULT_DAYS;
	if (trimmed) {
		const parsed = parseInt(trimmed, 10);
		if (isNaN(parsed) || parsed < 1) {
			ctx.ui.notify(
				`Invalid argument: "${trimmed}". Usage: /clean-sessions [days]\nExample: /clean-sessions 60`,
				"warning",
			);
			return;
		}
		olderThanDays = parsed;
	}

	// Ensure the sessions directory exists.
	try {
		await fs.access(SESSIONS_DIR);
	} catch {
		ctx.ui.notify(`Sessions directory not found: ${SESSIONS_DIR}`, "error");
		return;
	}

	// Scan.
	ctx.ui.notify(
		`Scanning sessions older than ${olderThanDays} days with fewer than ${MIN_LINES} lines...`,
		"info",
	);
	ctx.ui.setWorkingMessage?.(
		`Scanning old sessions (${olderThanDays}d lookback)...`,
	);
	ctx.ui.setWorkingIndicator?.({ frames: ["[scan]"], intervalMs: 120 });

	const candidates = await findCandidates({ olderThanDays });

	ctx.ui.setWorkingMessage?.();
	ctx.ui.setWorkingIndicator?.();

	if (candidates.length === 0) {
		ctx.ui.notify(
			`No cleanup candidates found (older than ${olderThanDays}d, fewer than ${MIN_LINES} lines, auto-named or unnamed).`,
			"info",
		);
		return;
	}

	// Always dry-run first: show candidates.
	ctx.ui.notify(
		renderCandidateList(candidates, olderThanDays, MIN_LINES),
		"info",
	);

	// Confirm by typing the exact count.
	const confirmed = await confirmExactCount(
		ctx,
		candidates.length,
		renderConfirmPrompt(candidates.length, "move these sessions to .trash/"),
		"Cleanup canceled. No files were moved.",
	);

	if (!confirmed) return;

	// Execute the move.
	ctx.ui.setWorkingMessage?.(
		`Moving ${candidates.length} session(s) to trash...`,
	);
	ctx.ui.setWorkingIndicator?.({ frames: ["[trash]"], intervalMs: 120 });

	const result = await moveToTrash(candidates);

	ctx.ui.setWorkingMessage?.();
	ctx.ui.setWorkingIndicator?.();

	const level = result.failedCount > 0 ? "warning" : "info";
	ctx.ui.notify(renderCleanupResult(result.movedCount, result.failedCount), level);
}

// ============================================================================
// /empty-session-trash
// ============================================================================

export async function handleEmptySessionTrash(
	_args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!ensureInteractive(ctx, "/empty-session-trash")) return;

	const trash = await listTrash();

	if (trash.subdirs.length === 0) {
		ctx.ui.notify("Session trash is already empty.", "info");
		return;
	}

	// Use total file count from the trash listing. The listTrash function
	// walks all subdirs and provides totalSize, but we also need file count.
	// We derive it from the subdir count — each subdir is a cleanup run.
	// For the confirmation prompt, we display the number of subdirs.
	const subdirCount = trash.subdirs.length;

	ctx.ui.notify(
		`Session trash contains ${subdirCount} cleanup ${subdirCount === 1 ? "batch" : "batches"} (${formatBytes(trash.totalSize)}).`,
		"info",
	);

	const confirmed = await confirmExactCount(
		ctx,
		subdirCount,
		renderConfirmPrompt(subdirCount, "permanently delete all trashed sessions"),
		"Canceled. Trash was not emptied.",
	);

	if (!confirmed) return;

	const result = await emptyTrash({});
	ctx.ui.notify(renderTrashDeletionResult(result.removedCount), "info");
}

// ============================================================================
// Internal helpers
// ============================================================================

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
