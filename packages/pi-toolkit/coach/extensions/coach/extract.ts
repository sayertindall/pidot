import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import { abbreviatePath, MAX_ASSISTANT_CHARS, MAX_MSG_CHARS, messageContentToText, truncate } from "./summarize";
import type { SessionDigest } from "./types";

export function digestSession(entries: SessionEntry[], cwd: string, info?: SessionInfo): SessionDigest {
	const userMessages: string[] = [];
	const assistantSnippets: string[] = [];
	const toolCalls: Array<{ tool: string; path?: string }> = [];
	const filesRead = new Set<string>();
	const filesEdited = new Set<string>();
	let branchPointCount = 0;
	let compactionCount = 0;
	let labelCount = 0;

	const childCounts = new Map<string, number>();
	for (const entry of entries) {
		if (entry.parentId) {
			childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
		}
	}
	for (const count of childCounts.values()) {
		if (count > 1) branchPointCount++;
	}

	for (const entry of entries) {
		if (entry.type === "compaction") compactionCount++;
		if (entry.type === "label" && entry.label) labelCount++;
		if (entry.type !== "message") continue;

		if (entry.message.role === "user") {
			const text = truncate(messageContentToText(entry.message.content), MAX_MSG_CHARS);
			if (text) userMessages.push(text);
		}

		if (entry.message.role === "assistant") {
			const text = truncate(messageContentToText(entry.message.content), MAX_ASSISTANT_CHARS);
			if (text) assistantSnippets.push(text);

			const content = entry.message.content;
			if (!Array.isArray(content)) continue;
			for (const block of content) {
				if (!block || typeof block !== "object") continue;
				const typed = block as { type?: string; name?: string; arguments?: Record<string, unknown> };
				if (typed.type !== "toolCall" || !typed.name) continue;

				const args = typed.arguments ?? {};
				const filePath = typeof args.path === "string" ? abbreviatePath(args.path, cwd) : undefined;

				toolCalls.push({ tool: typed.name, path: filePath });

				if (typed.name === "read" && filePath) filesRead.add(filePath);
				if ((typed.name === "edit" || typed.name === "write") && filePath) filesEdited.add(filePath);
			}
		}
	}

	return {
		name: info?.name ?? undefined,
		created: info?.created?.toISOString().slice(0, 16) ?? "unknown",
		entryCount: entries.length,
		branchPoints: branchPointCount,
		compactions: compactionCount,
		labels: labelCount,
		isForked: Boolean(info?.parentSessionPath),
		userMessages,
		assistantSnippets,
		toolCalls,
		filesRead: [...filesRead],
		filesEdited: [...filesEdited],
	};
}
