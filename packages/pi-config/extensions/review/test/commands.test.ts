/**
 * review/test/commands.test.ts
 */
import { describe, expect, it } from "vitest";
import { parseReviewArgs } from "../commands";

describe("parseReviewArgs", () => {
	it("returns help on empty input", () => {
		expect(parseReviewArgs("")).toEqual({ kind: "help" });
	});

	it("parses uncommitted", () => {
		expect(parseReviewArgs("uncommitted")).toEqual({ kind: "uncommitted", extra: undefined });
	});

	it("parses branch with a name", () => {
		expect(parseReviewArgs("branch main")).toEqual({ kind: "branch", branch: "main", extra: undefined });
	});

	it("returns help when branch has no name", () => {
		expect(parseReviewArgs("branch")).toEqual({ kind: "help" });
	});

	it("parses commit with sha and optional title", () => {
		expect(parseReviewArgs("commit abc1234 fix the bug")).toEqual({
			kind: "commit",
			sha: "abc1234",
			title: "fix the bug",
			extra: undefined,
		});
	});

	it("parses pr with a number", () => {
		expect(parseReviewArgs("pr 42")).toEqual({ kind: "pr", ref: "42", extra: undefined });
	});

	it("parses status / cancel", () => {
		expect(parseReviewArgs("status")).toEqual({ kind: "status" });
		expect(parseReviewArgs("cancel")).toEqual({ kind: "cancel" });
	});

	it("captures --extra", () => {
		expect(parseReviewArgs("uncommitted --extra focus on edge cases")).toEqual({
			kind: "uncommitted",
			extra: "focus on edge cases",
		});
	});

	it("captures --extra=value form", () => {
		expect(parseReviewArgs("branch main --extra=look at auth")).toEqual({
			kind: "branch",
			branch: "main",
			extra: "look at auth",
		});
	});

	it("returns help for unknown subcommands", () => {
		expect(parseReviewArgs("nope")).toEqual({ kind: "help" });
	});
});
