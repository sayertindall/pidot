import { describe, expect, it } from "vitest";
import { messageContentToText, truncate, abbreviatePath } from '../summarize';

describe("messageContentToText", () => {
	it("returns string content directly", () => {
		expect(messageContentToText("hello world")).toBe("hello world");
	});

	it("flattens array of text blocks", () => {
		const content = [
			{ type: "text", text: "first line" },
			{ type: "text", text: "second line" },
		];
		expect(messageContentToText(content)).toBe("first line\nsecond line");
	});

	it("ignores non-text blocks", () => {
		const content = [
			{ type: "text", text: "hello" },
			{ type: "toolCall", name: "read" },
			{ type: "text", text: "world" },
		];
		expect(messageContentToText(content)).toBe("hello\nworld");
	});

	it("returns empty string for non-string, non-array", () => {
		expect(messageContentToText(42)).toBe("");
		expect(messageContentToText(null)).toBe("");
		expect(messageContentToText(undefined)).toBe("");
	});

	it("returns empty string for empty array", () => {
		expect(messageContentToText([])).toBe("");
	});

	it("handles blocks with no text property", () => {
		const content = [{ type: "image" }];
		expect(messageContentToText(content)).toBe("");
	});

	it("filters out falsy blocks", () => {
		const content = [null, { type: "text", text: "valid" }, undefined];
		expect(messageContentToText(content)).toBe("valid");
	});
});

describe("truncate", () => {
	it("returns text unchanged when within limit", () => {
		expect(truncate("short", 10)).toBe("short");
	});

	it("truncates and appends ellipsis", () => {
		expect(truncate("hello world this is long", 10)).toBe("hello wor…");
	});

	it("collapses whitespace before truncating", () => {
		expect(truncate("hello   world   test", 20)).toBe("hello world test");
	});

	it("returns clean text at exact limit", () => {
		expect(truncate("abcde", 5)).toBe("abcde");
	});

	it("handles empty string", () => {
		expect(truncate("", 10)).toBe("");
	});
});

describe("abbreviatePath", () => {
	it("returns relative path when under cwd", () => {
		expect(abbreviatePath("/home/user/project/src/file", "/home/user/project"))
			.toBe("src/file");
	});

	it("returns home-relative path when under HOME", () => {
		const home = process.env.HOME ?? "/home/user";
		expect(abbreviatePath(`${home}/.pi/agent/sessions/file.jsonl`, "/other"))
			.toBe("~/.pi/agent/sessions/file.jsonl");
	});

	it("returns original path when neither cwd nor home match", () => {
		expect(abbreviatePath("/tmp/somefile", "/home/user/project"))
			.toBe("/tmp/somefile");
	});

	it("does not abbreviate partial directory name matches", () => {
		expect(abbreviatePath("/home/user/proj/file", "/home/user/project"))
			.toBe("/home/user/proj/file");
	});
});
