import { expect, test } from "vitest";
import { parsePublicHttpUrl } from "../types.ts";
import { formatSearchResults } from "../websearch.ts";

test("formatSearchResults renders deterministic URL-forward output", () => {
	const url = parsePublicHttpUrl("https://example.com/");
	expect(url._tag).toBe("ok");

	const output = formatSearchResults("example query", [
		{
			title: "Example Domain",
			url: url.value,
			snippet: "Documentation-safe example domain.",
		},
	]);
	expect(output).toBe(
		[
			"Search results for: example query",
			"",
			"1. Example Domain",
			"   URL: https://example.com/",
			"   Snippet: Documentation-safe example domain.",
		].join("\n"),
	);
});
