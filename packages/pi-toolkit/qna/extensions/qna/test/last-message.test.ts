/**
 * last-message.test.ts
 *
 * Unit tests for the last-message helper. Walks a session branch
 * in reverse and pulls the most recent assistant message text.
 */

import { describe, expect, it } from "vitest";
import { getLastAssistantText } from '../last-message';

function fakeCtx(branch: any[]) {
	return {
		sessionManager: { getBranch: () => branch },
	} as any;
}

describe("getLastAssistantText", () => {
	it("returns null for an empty branch", () => {
		expect(getLastAssistantText(fakeCtx([]))).toBeNull();
	});

	it("returns null when no assistant messages exist", () => {
		const ctx = fakeCtx([
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
		]);
		expect(getLastAssistantText(ctx)).toBeNull();
	});

	it("returns the text and stop reason of the most recent assistant message", () => {
		const ctx = fakeCtx([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "old response" }],
					stopReason: "stop",
				},
			},
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "user prompt" }],
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "newest response" }],
					stopReason: "stop",
				},
			},
		]);
		const result = getLastAssistantText(ctx);
		expect(result).toEqual({ text: "newest response", stopReason: "stop" });
	});

	it("joins multiple text parts with newlines", () => {
		const ctx = fakeCtx([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "part one" },
						{ type: "text", text: "part two" },
					],
					stopReason: "stop",
				},
			},
		]);
		const result = getLastAssistantText(ctx);
		expect(result?.text).toBe("part one\npart two");
	});

	it("skips assistant messages with no text content", () => {
		const ctx = fakeCtx([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", toolName: "bash" }],
					stopReason: "stop",
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "real response" }],
					stopReason: "stop",
				},
			},
		]);
		const result = getLastAssistantText(ctx);
		expect(result?.text).toBe("real response");
	});

	it("returns undefined stopReason for messages that don't set it", () => {
		const ctx = fakeCtx([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					// stopReason intentionally absent
				},
			},
		]);
		const result = getLastAssistantText(ctx);
		expect(result?.stopReason).toBeUndefined();
	});
});
