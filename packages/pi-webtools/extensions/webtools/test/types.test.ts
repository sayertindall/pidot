import { expect, test } from "vitest";
import { parsePublicHttpUrl, redactUrlCredentialsForDisplay } from "../types.ts";

test("parsePublicHttpUrl requires explicit HTTP URL slashes", () => {
	expect(parsePublicHttpUrl("http:example.com")).toEqual({
		_tag: "err",
		error: { _tag: "UnsupportedUrlProtocol", protocol: "http:" },
	});
});

test("parsePublicHttpUrl rejects URL credentials with redacted diagnostics", () => {
	const result = parsePublicHttpUrl("https://user:pass@example.com/docs");

	expect(result._tag).toBe("err");
	expect(result.error._tag).toBe("UrlCredentialsUnsupported");
	if (result.error._tag !== "UrlCredentialsUnsupported") {
		return;
	}
	expect(String(result.error.url)).toBe("<redacted>");
	expect(JSON.parse(JSON.stringify(result.error))).toEqual({
		_tag: "UrlCredentialsUnsupported",
		url: "<redacted>",
	});
});

test("parsePublicHttpUrl redacts invalid URL input in parse errors", () => {
	const result = parsePublicHttpUrl("http://user:pass@");

	expect(result._tag).toBe("err");
	expect(result.error._tag).toBe("InvalidUrl");
	if (result.error._tag !== "InvalidUrl") {
		return;
	}
	expect(String(result.error.input)).toBe("<redacted>");
	expect(JSON.parse(JSON.stringify(result.error))).toEqual({
		_tag: "InvalidUrl",
		input: "<redacted>",
	});
});

test("redactUrlCredentialsForDisplay hides userinfo credentials only", () => {
	expect(redactUrlCredentialsForDisplay("https://user:pass@example.com/docs")).toBe("<redacted>");
	expect(redactUrlCredentialsForDisplay("https://example.com/docs")).toBe("https://example.com/docs");
	expect(redactUrlCredentialsForDisplay("http://user:pass@")).toBe("<redacted>");
});
