import { expect, test } from "vitest";
import {
	createWebFetchTool,
	createWebFetchHeaders,
	getFallbackUserAgent,
	OPENCODE_WEBFETCH_DEFAULT_USER_AGENT,
	OPENCODE_WEBFETCH_FALLBACK_USER_AGENT,
	shouldRetryWithFallbackUserAgent,
} from "../webfetch.ts";

test("webfetch execute rejects URL credentials with a safe message", async () => {
	const tool = createWebFetchTool();

	await expect(
		tool.execute("id", { url: "https://user:pass@example.com/secret" }),
	).rejects.toThrow("URL credentials are not supported");
});

test("createWebFetchHeaders uses the OpenCode browser-like default user agent", () => {
	const headers = createWebFetchHeaders("text/html");
	expect(headers["User-Agent"]).toBe(OPENCODE_WEBFETCH_DEFAULT_USER_AGENT);
	expect(headers.Accept).toBe("text/html");
	expect(headers["Accept-Language"]).toBe("en-US,en;q=0.9");
});

test("getFallbackUserAgent prefers the configured setting and otherwise falls back to opencode", () => {
	expect(getFallbackUserAgent("my-agent/1.0")).toBe("my-agent/1.0");
	expect(getFallbackUserAgent("  custom-agent  ")).toBe("custom-agent");
	expect(getFallbackUserAgent("")).toBe(OPENCODE_WEBFETCH_FALLBACK_USER_AGENT);
	expect(getFallbackUserAgent("   ")).toBe(OPENCODE_WEBFETCH_FALLBACK_USER_AGENT);
	expect(getFallbackUserAgent(undefined)).toBe(OPENCODE_WEBFETCH_FALLBACK_USER_AGENT);
});

test("shouldRetryWithFallbackUserAgent only retries the Cloudflare challenge case", () => {
	expect(
		shouldRetryWithFallbackUserAgent({
			status: 403,
			headers: new Headers({ "cf-mitigated": "challenge" }),
		}),
	).toBe(true);
	expect(
		shouldRetryWithFallbackUserAgent({
			status: 403,
			headers: new Headers(),
		}),
	).toBe(false);
	expect(
		shouldRetryWithFallbackUserAgent({
			status: 429,
			headers: new Headers({ "cf-mitigated": "challenge" }),
		}),
	).toBe(false);
});
