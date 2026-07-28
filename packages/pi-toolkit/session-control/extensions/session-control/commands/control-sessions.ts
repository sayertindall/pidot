/**
 * control-sessions.ts — /control-sessions command
 *
 * Lists live sessions in the TUI. Read-only — no message sent, no turn triggered.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getLiveSessions } from "../registry";

export function registerControlSessionsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("control-sessions", {
		description: "List live sessions with control sockets",
		handler: async (_args, ctx) => {
			const sessions = await getLiveSessions();
			const currentSessionId = ctx.sessionManager.getSessionId();

			const lines = sessions.map((s) => {
				const name = s.name ? ` (${s.name})` : "";
				const current = s.sessionId === currentSessionId ? " (current)" : "";
				const tags = Object.entries(s.tags)
					.map(([k, v]) => `${k}:${v}`)
					.join(", ");
				const tagStr = tags ? ` [${tags}]` : "";
				return `- ${s.sessionId}${name}${current}${tagStr}`;
			});

			const content =
				sessions.length === 0
					? "No live sessions found."
					: `Live sessions:\n${lines.join("\n")}`;

			pi.sendMessage(
				{
					customType: "control-sessions",
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}
