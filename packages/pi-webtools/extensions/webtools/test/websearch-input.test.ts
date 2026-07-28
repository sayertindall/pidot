import { expect, test } from "vitest";
import { parseWebSearchToolParams } from "../websearch-input.ts";
import { parsePublicHttpUrl, type WebToolsSettings } from "../types.ts";

const endpoint = mustParsePublicHttpUrl("https://example.test/mcp");

const testSearchSettings: WebToolsSettings["search"] = {
	enabled: true,
	provider: "exa",
	endpoint,
	timeoutSeconds: 25,
	defaultMaxResults: 8,
	defaultDepth: "auto",
};

test("parseWebSearchToolParams trims query and applies defaults", () => {
	const result = parseWebSearchToolParams({ query: "  example docs  " }, testSearchSettings);

	expect(result._tag).toBe("ok");
	expect(result.value.query).toBe("example docs");
	expect(result.value.maxResults).toBe(8);
	expect(result.value.depth).toBe("auto");
	expect(result.value.timeoutSeconds).toBe(25);
});

test("parseWebSearchToolParams accepts deep and clamps maxResults", () => {
	const low = parseWebSearchToolParams({ query: "example", maxResults: 0, depth: "deep" }, testSearchSettings);
	const high = parseWebSearchToolParams({ query: "example", maxResults: 999 }, testSearchSettings);
	const clampedDefault = parseWebSearchToolParams(
		{ query: "example" },
		{ ...testSearchSettings, defaultMaxResults: 999 },
	);

	expect(low._tag).toBe("ok");
	expect(low.value.depth).toBe("deep");
	expect(low.value.maxResults).toBe(1);
	expect(high._tag).toBe("ok");
	expect(high.value.maxResults).toBe(20);
	expect(clampedDefault._tag).toBe("ok");
	expect(clampedDefault.value.maxResults).toBe(20);
});

test("parseWebSearchToolParams rejects invalid boundary input", () => {
	expect(parseWebSearchToolParams({ query: "   " }, testSearchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "EmptySearchQuery" },
	});
	expect(parseWebSearchToolParams({ query: "example", depth: "slow" }, testSearchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "InvalidToolField", field: "depth", message: "Expected one of: auto, fast, deep" },
	});
	expect(parseWebSearchToolParams({ query: "example", maxResults: "8" }, testSearchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "InvalidToolField", field: "maxResults", message: "Expected a finite number" },
	});
	expect(parseWebSearchToolParams({ query: "example", timeout: 1 }, testSearchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "UnknownToolField", field: "timeout" },
	});
});

function mustParsePublicHttpUrl(input: string) {
	const parsed = parsePublicHttpUrl(input);
	if (parsed._tag === "err") {
		throw new Error("Invalid test URL");
	}
	return parsed.value;
}
