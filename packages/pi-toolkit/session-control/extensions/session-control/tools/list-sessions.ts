/**
 * list-sessions.ts — list_sessions tool
 *
 * Discover live sessions with optional tag filtering.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getLiveSessions } from "../registry";
import type { SessionTags } from "../types";

export function registerListSessionsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "list_sessions",
		label: "List Sessions",
		description: `List live sessions with control sockets. Use for discovery — filter by tags to find workers, pools, or specific projects.

For the current session id in shell/bash, use $PI_SESSION_ID (set when session-control is loaded).`,
		parameters: Type.Object({
			tags: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Filter by session tags (e.g., { role: 'worker', pool: 'auth-refactor' })",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const sessions = await getLiveSessions((params.tags ?? {}) as SessionTags);

			if (sessions.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No live sessions found." }],
					details: { sessions: [] },
				};
			}

			const lines = sessions.map((s) => {
				const name = s.name ? ` (${s.name})` : "";
				const tags = Object.entries(s.tags)
					.map(([k, v]) => `${k}:${v}`)
					.join(", ");
				const tagStr = tags ? ` [${tags}]` : "";
				return `- ${s.sessionId}${name}${tagStr}`;
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Live sessions:\n${lines.join("\n")}`,
					},
				],
				details: { sessions },
			};
		},
	});
}
