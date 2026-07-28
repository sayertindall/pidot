/**
 * context7/test/commands.test.ts
 */
import { describe, expect, it } from "vitest";
import { parseContext7Args } from "../commands";

describe("parseContext7Args", () => {
	it("returns help on empty input", () => {
		expect(parseContext7Args("")).toEqual({ kind: "help" });
	});

	it("parses search with a name", () => {
		expect(parseContext7Args("search react")).toEqual({ kind: "search", libraryName: "react" });
	});

	it("returns help when search has no name", () => {
		expect(parseContext7Args("search")).toEqual({ kind: "help" });
	});

	it("parses lookup with id and query", () => {
		expect(parseContext7Args("lookup /react/hooks how to use useState")).toEqual({
			kind: "lookup",
			libraryId: "/react/hooks",
			query: "how to use useState",
		});
	});

	it("returns help when lookup is missing the query", () => {
		expect(parseContext7Args("lookup /react")).toEqual({ kind: "help" });
	});

	it("returns help for unknown subcommands", () => {
		expect(parseContext7Args("nope")).toEqual({ kind: "help" });
	});
});
