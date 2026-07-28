/**
 * pi-toolkit-clean-sessions — index
 *
 * Extension factory. Registers two commands:
 *   /clean-sessions [days] — find and trash old sessions (dry-run first)
 *   /empty-session-trash    — permanently delete trashed sessions
 *
 * Wiring only. The actual work happens in:
 *   - candidate.ts: scan sessions directory, filter candidates
 *   - scoring.ts:   auto-name detection, exemption logic
 *   - trash.ts:     moveToTrash, listTrash, emptyTrash
 *   - command.ts:   handler logic with confirm flow
 *   - render.ts:    plain-string formatters
 *   - io.ts:        streaming line reader + counter
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	handleCleanSessions,
	handleEmptySessionTrash,
} from "./command";

export default function cleanSessionsExtension(pi: ExtensionAPI): void {
	pi.registerCommand("clean-sessions", {
		description:
			"Prune old, low-value session files (dry-run first, then confirm)",
		handler: handleCleanSessions,
	});

	pi.registerCommand("empty-session-trash", {
		description: "Permanently delete all trashed sessions",
		handler: handleEmptySessionTrash,
	});
}
