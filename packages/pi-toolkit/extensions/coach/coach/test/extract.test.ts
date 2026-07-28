import { describe, expect, it } from "vitest";
import { digestSession } from '../extract';
import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

function makeEntry(overrides: Record<string, unknown> = {}): SessionEntry {
	return {
		id: "entry-1",
		parentId: undefined,
		type: "message",
		timestamp: 1700000000000,
		message: {
			role: "user",
			content: "hello",
			timestamp: 1700000000000,
		},
		...overrides,
	} as unknown as SessionEntry;
}

function makeInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: "/home/user/.pi/agent/sessions/hash/session.jsonl",
		name: "test-session",
		created: new Date("2025-01-15T10:30:00Z"),
		parentSessionPath: undefined,
		...overrides,
	} as SessionInfo;
}

describe("digestSession", () => {
	it("extracts user messages", () => {
		const entries = [
			makeEntry({ message: { role: "user" as const, content: "Hello world" as any, timestamp: 1 } } as any),
			makeEntry({ message: { role: "user" as const, content: "Fix the bug" as any, timestamp: 2 } } as any),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.userMessages).toEqual(["Hello world", "Fix the bug"]);
	});

	it("truncates long user messages", () => {
		const longText = "a".repeat(600);
		const entries = [
			makeEntry({ message: { role: "user", content: longText, timestamp: 1 } }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.userMessages[0]!.length).toBeLessThanOrEqual(500);
		expect(digest.userMessages[0]!.endsWith("…")).toBe(true);
	});

	it("extracts assistant snippets", () => {
		const entries = [
			makeEntry({ message: { role: "assistant", content: "I'll help with that", timestamp: 2 } }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.assistantSnippets).toEqual(["I'll help with that"]);
	});

	it("truncates long assistant responses", () => {
		const longText = "b".repeat(300);
		const entries = [
			makeEntry({ message: { role: "assistant", content: longText, timestamp: 2 } }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.assistantSnippets[0]!.length).toBeLessThanOrEqual(200);
	});

	it("extracts tool calls with paths", () => {
		const entries = [
			makeEntry({
				message: {
					role: "assistant" as const,
					content: [
						{ type: "text", text: "Let me read that" },
						{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "/project/src/file" } },
						{ type: "toolCall", id: "tc2", name: "edit", arguments: { path: "/project/src/file" } },
					],
					timestamp: 2,
				},
			}),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.toolCalls).toHaveLength(2);
		expect(digest.toolCalls[0]!.tool).toBe("read");
		expect(digest.toolCalls[0]!.path).toBe("src/file");
		expect(digest.toolCalls[1]!.tool).toBe("edit");
		expect(digest.toolCalls[1]!.path).toBe("src/file");
	});

	it("tracks files read and edited", () => {
		const entries = [
			makeEntry({
				message: {
					role: "assistant" as const,
					content: [
						{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "/project/a" } },
						{ type: "toolCall", id: "tc2", name: "read", arguments: { path: "/project/b" } },
						{ type: "toolCall", id: "tc3", name: "edit", arguments: { path: "/project/c" } },
						{ type: "toolCall", id: "tc4", name: "write", arguments: { path: "/project/d" } },
					],
					timestamp: 2,
				},
			}),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.filesRead).toContain("a");
		expect(digest.filesRead).toContain("b");
		expect(digest.filesEdited).toContain("c");
		expect(digest.filesEdited).toContain("d");
	});

	it("deduplicates files read", () => {
		const entries = [
			makeEntry({
				message: {
					role: "assistant" as const,
					content: [
						{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "/project/a" } },
					],
					timestamp: 2,
				},
			}),
			makeEntry({
				id: "entry-2",
				message: {
					role: "assistant" as const,
					content: [
						{ type: "toolCall", id: "tc2", name: "read", arguments: { path: "/project/a" } },
					],
					timestamp: 3,
				},
			}),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.filesRead).toEqual(["a"]);
	});

	it("counts branch points from entries sharing a parentId", () => {
		const entries = [
			makeEntry({ id: "parent", parentId: undefined }),
			makeEntry({ id: "child-1", parentId: "parent" }),
			makeEntry({ id: "child-2", parentId: "parent" }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.branchPoints).toBe(1);
	});

	it("counts compactions", () => {
		const entries = [
			makeEntry({ type: "compaction" as const }),
			makeEntry({ type: "compaction" as const }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.compactions).toBe(2);
	});

	it("counts labels", () => {
		const entries = [
			makeEntry({ type: "label" as const, label: "checkpoint 1" }),
		];
		const digest = digestSession(entries, "/project");
		expect(digest.labels).toBe(1);
	});

	it("uses SessionInfo for metadata", () => {
		const entries: SessionEntry[] = [];
		const info = makeInfo({
			name: "my-session",
			created: new Date("2025-01-15T10:30:00Z"),
			parentSessionPath: "/parent/session.jsonl",
		});
		const digest = digestSession(entries, "/project", info);
		expect(digest.name).toBe("my-session");
		expect(digest.created).toBe("2025-01-15T10:30");
		expect(digest.isForked).toBe(true);
	});

	it("handles missing SessionInfo", () => {
		const entries: SessionEntry[] = [];
		const digest = digestSession(entries, "/project");
		expect(digest.name).toBeUndefined();
		expect(digest.isForked).toBe(false);
	});
});
