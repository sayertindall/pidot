/**
 * pi-toolkit-qna — last-message
 *
 * Pulls the text of the last assistant message from a session branch.
 * Returns the stop reason so the caller can reject incomplete
 * messages (e.g., aborted or errored turns).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface LastAssistantMessage {
	text: string;
	stopReason: string | undefined;
}

/**
 * Walk the session branch in reverse, return the text of the most
 * recent assistant message. Returns null if no assistant message
 * with text content exists.
 */
export function getLastAssistantText(ctx: ExtensionContext): LastAssistantMessage | null {
	const branch = ctx.sessionManager.getBranch() as any[];
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "assistant") continue;
		const textParts = (msg.content ?? [])
			.filter((c: any): c is { type: "text"; text: string } => c?.type === "text")
			.map((c: any) => c.text);
		if (textParts.length === 0) continue;
		return {
			text: textParts.join("\n"),
			stopReason: msg.stopReason,
		};
	}
	return null;
}
