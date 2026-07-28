import { expect, test } from "vitest";
import { parseWebFetchToolParams } from "../webfetch-input.ts";
import type { WebToolsSettings } from "../types.ts";

const testFetchSettings: WebToolsSettings["fetch"] = {
	defaultFormat: "markdown",
	timeoutSeconds: 30,
	maxResponseBytes: 5 * 1024 * 1024,
	blockPrivateHosts: true,
	maxRedirects: 5,
	fallbackUserAgent: "opencode",
};

test("parseWebFetchToolParams parses url and applies defaults", () => {
	const result = parseWebFetchToolParams({ url: " https://example.com/docs " }, testFetchSettings);

	expect(result._tag).toBe("ok");
	expect(result.value.format).toBe("markdown");
	expect(result.value.timeoutSeconds).toBe(30);
	expect(result.value.url).toBe("https://example.com/docs");
});

test("parseWebFetchToolParams rejects invalid boundary input", () => {
	expect(parseWebFetchToolParams({ url: "   " }, testFetchSettings)._tag).toBe("err");
	expect(parseWebFetchToolParams({ url: "ftp://example.com" }, testFetchSettings)._tag).toBe("err");
	expect(parseWebFetchToolParams({ url: "https://example.com", format: "pdf" }, testFetchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "InvalidToolField", field: "format", message: "Expected one of: markdown, text, html" },
	});
	expect(parseWebFetchToolParams({ url: "https://example.com", depth: "auto" }, testFetchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "UnknownToolField", field: "depth" },
	});
	expect(parseWebFetchToolParams({ url: "https://example.com", timeout: "30" }, testFetchSettings)).toEqual({
		_tag: "err",
		error: { _tag: "InvalidToolField", field: "timeout", message: "Expected a finite number" },
	});

	const credentialedUrl = parseWebFetchToolParams({ url: "https://user:pass@example.com" }, testFetchSettings);
	expect(credentialedUrl._tag).toBe("err");
	if (credentialedUrl._tag !== "err") {
		return;
	}
	expect(credentialedUrl.error._tag).toBe("UrlCredentialsUnsupported");
	expect(JSON.stringify(credentialedUrl.error)).not.toMatch(/user|pass/);
});

test("parseWebFetchToolParams clamps timeout to supported bounds", () => {
	const low = parseWebFetchToolParams({ url: "https://example.com", timeout: 0 }, testFetchSettings);
	const high = parseWebFetchToolParams({ url: "https://example.com", timeout: 999 }, testFetchSettings);
	const clampedDefault = parseWebFetchToolParams(
		{ url: "https://example.com" },
		{ ...testFetchSettings, timeoutSeconds: 999 },
	);

	expect(low._tag).toBe("ok");
	expect(low.value.timeoutSeconds).toBe(1);
	expect(high._tag).toBe("ok");
	expect(high.value.timeoutSeconds).toBe(120);
	expect(clampedDefault._tag).toBe("ok");
	expect(clampedDefault.value.timeoutSeconds).toBe(120);
});
