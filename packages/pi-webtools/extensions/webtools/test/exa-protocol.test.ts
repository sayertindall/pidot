import { expect, test } from "vitest";
import { parseExaMcpResponse, parseSseDataLines } from "../providers/exa-protocol.ts";

const PROVIDER_TEXT = [
	"Title: Example Domain",
	"URL: https://example.com/",
	"Text: Example Domain",
	"",
	"Documentation-safe example domain.",
].join("\n");

const SSE_RESPONSE = `event: message\ndata: ${JSON.stringify({
	result: {
		content: [{ type: "text", text: PROVIDER_TEXT }],
	},
	jsonrpc: "2.0",
	id: 1,
})}\n\n`;

const SSE_ERROR_RESPONSE = `event: message\ndata: ${JSON.stringify({
	result: {
		content: [{ type: "text", text: "MCP error -32602: Invalid enum value" }],
		isError: true,
	},
	jsonrpc: "2.0",
	id: 1,
})}\n\n`;

test("parseSseDataLines extracts JSON payloads from event streams", () => {
	const chunks = parseSseDataLines(SSE_RESPONSE);
	expect(chunks.length).toBe(1);
	expect(chunks[0] ?? "").toMatch(/"jsonrpc":"2.0"/);
});

test("parseExaMcpResponse extracts text messages from SSE", () => {
	const result = parseExaMcpResponse(SSE_RESPONSE, "text/event-stream");

	expect(result._tag).toBe("ok");
	expect(result.value[0]?._tag).toBe("Text");
	expect(result.value[0]?._tag === "Text" ? result.value[0].text : "").toMatch(/^Title: Example Domain/m);
});

test("parseExaMcpResponse extracts provider error messages safely", () => {
	const result = parseExaMcpResponse(SSE_ERROR_RESPONSE, "text/event-stream");

	expect(result).toEqual({
		_tag: "ok",
		value: [{ _tag: "ProviderError", safeMessage: "Search provider returned an error" }],
	});
});

test("parseExaMcpResponse parses JSON MCP responses", () => {
	const result = parseExaMcpResponse(
		JSON.stringify({ result: { content: [{ type: "text", text: PROVIDER_TEXT }] } }),
		"application/json",
	);

	expect(result._tag).toBe("ok");
	expect(result.value[0]?._tag).toBe("Text");
});

test("parseExaMcpResponse rejects malformed payloads without trust casts", () => {
	expect(parseExaMcpResponse("{", "application/json")).toEqual({
		_tag: "err",
		error: { _tag: "InvalidJson", source: "json" },
	});
	expect(parseExaMcpResponse(JSON.stringify({ result: {} }), "application/json")).toEqual({
		_tag: "err",
		error: { _tag: "InvalidMcpPayload", reason: "Missing result.content array" },
	});
	expect(parseExaMcpResponse("event: message\ndata: {\n\n", "text/event-stream")).toEqual({
		_tag: "err",
		error: { _tag: "InvalidJson", source: "sse" },
	});
});
