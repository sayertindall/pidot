import { expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { FetchPublicWebClient, classifyMimeType, isPrivateOrLocalIp, parseContentType } from "../network.ts";
import { parsePublicHttpUrl } from "../types.ts";
import type { PublicWebRequest } from "../public-web-client.ts";

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

test("parseContentType normalizes html and xhtml content types", () => {
	expect(parseContentType("TEXT/HTML; charset=UTF-8").kind).toBe("html");
	expect(parseContentType("TEXT/HTML; charset=UTF-8").mime).toBe("text/html");
	expect(parseContentType("application/xhtml+xml; charset=utf-8").kind).toBe("html");
	expect(parseContentType("image/svg+xml").kind).toBe("svg");
});

test("classifyMimeType recognizes supported raster images and binary fallback", () => {
	expect(classifyMimeType("image/png")).toBe("raster-image");
	expect(classifyMimeType("application/octet-stream")).toBe("binary");
	expect(classifyMimeType("application/json")).toBe("text");
});

test("isPrivateOrLocalIp detects local and private IP ranges", () => {
	expect(isPrivateOrLocalIp("127.0.0.1")).toBe(true);
	expect(isPrivateOrLocalIp("10.0.0.5")).toBe(true);
	expect(isPrivateOrLocalIp("192.168.1.20")).toBe(true);
	expect(isPrivateOrLocalIp("172.20.0.1")).toBe(true);
	expect(isPrivateOrLocalIp("::1")).toBe(true);
	expect(isPrivateOrLocalIp("fc00::1")).toBe(true);
	expect(isPrivateOrLocalIp("::ffff:127.0.0.1")).toBe(true);
	expect(isPrivateOrLocalIp("::ffff:7f00:1")).toBe(true);
	expect(isPrivateOrLocalIp("0:0:0:0:0:ffff:7f00:1")).toBe(true);
	expect(isPrivateOrLocalIp("::ffff:a00:1")).toBe(true);
	expect(isPrivateOrLocalIp("::ffff:c0a8:114")).toBe(true);
	expect(isPrivateOrLocalIp("::127.0.0.1")).toBe(true);
	expect(isPrivateOrLocalIp("::7f00:1")).toBe(true);
	expect(isPrivateOrLocalIp("8.8.8.8")).toBe(false);
	expect(isPrivateOrLocalIp("::ffff:808:808")).toBe(false);
});

test("FetchPublicWebClient follows redirects when private host blocking is disabled", async () => {
	const server = await startServer((request, response) => {
		if (request.url === "/redirect") {
			response.writeHead(302, { location: "/final" });
			response.end();
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	try {
		const client = new FetchPublicWebClient();
		const result = await client.get(makeRequest(`${server.origin}/redirect`, { blockPrivateHosts: false }));

		expect(result._tag).toBe("ok");
		expect(result.value.finalUrl).toBe(`${server.origin}/final`);
		expect(result.value.body.toString("utf8")).toBe("ok");
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient rejects private hosts before fetching", async () => {
	const client = new FetchPublicWebClient();
	const result = await client.get(makeRequest("http://localhost:9/", { blockPrivateHosts: true }));

	expect(result._tag).toBe("err");
	expect(result.error._tag).toBe("PrivateHostBlocked");
});

test("FetchPublicWebClient rejects IPv4-mapped IPv6 private hosts before fetching", async () => {
	const client = new FetchPublicWebClient();
	const result = await client.get(makeRequest("http://[::ffff:127.0.0.1]:9/", { blockPrivateHosts: true }));

	expect(result._tag).toBe("err");
	expect(result.error._tag).toBe("PrivateIpBlocked");
});

test("FetchPublicWebClient rejects redirects with URL credentials before fetching target", async () => {
	const server = await startServer((_request, response) => {
		response.writeHead(302, { location: "http://user:pass@example.com/secret" });
		response.end();
	});
	try {
		const client = new FetchPublicWebClient();
		const result = await client.get(makeRequest(server.origin, { blockPrivateHosts: false }));

		expect(result._tag).toBe("err");
		if (result._tag !== "err") {
			return;
		}
		expect(result.error._tag).toBe("UrlCredentialsUnsupported");
		expect(JSON.stringify(result.error)).not.toMatch(/user|pass/);
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient rejects oversized content-length and streamed bodies", async () => {
	const server = await startServer((request, response) => {
		if (request.url === "/length") {
			response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
			response.end();
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.write("123456");
		response.end();
	});
	try {
		const client = new FetchPublicWebClient();
		const tooLargeByLength = await client.get(
			makeRequest(`${server.origin}/length`, { blockPrivateHosts: false, maxResponseBytes: 5 }),
		);
		const tooLargeByBody = await client.get(
			makeRequest(`${server.origin}/body`, { blockPrivateHosts: false, maxResponseBytes: 5 }),
		);

		expect(tooLargeByLength._tag).toBe("err");
		expect(tooLargeByLength.error._tag).toBe("ResponseTooLarge");
		expect(tooLargeByBody._tag).toBe("err");
		expect(tooLargeByBody.error._tag).toBe("ResponseTooLarge");
	} finally {
		await server.close();
	}
});

test("FetchPublicWebClient retries Cloudflare challenge with fallback user agent", async () => {
	const seenUserAgents: string[] = [];
	const server = await startServer((request, response) => {
		seenUserAgents.push(request.headers["user-agent"] ?? "");
		if (request.headers["user-agent"] !== "fallback-agent") {
			response.writeHead(403, { "cf-mitigated": "challenge" });
			response.end("challenge");
			return;
		}
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("ok");
	});
	try {
		const client = new FetchPublicWebClient();
		const result = await client.get(
			makeRequest(server.origin, { blockPrivateHosts: false, fallbackUserAgent: "fallback-agent" }),
		);

		expect(result._tag).toBe("ok");
		expect(seenUserAgents).toEqual(["default-agent", "fallback-agent"]);
	} finally {
		await server.close();
	}
});

function makeRequest(
	url: string,
	overrides: { readonly blockPrivateHosts?: boolean; readonly maxResponseBytes?: number; readonly fallbackUserAgent?: string } = {},
): PublicWebRequest {
	const parsed = parsePublicHttpUrl(url);
	if (parsed._tag !== "ok") throw new Error("Invalid test URL");
	return {
		url: parsed.value,
		accept: "text/plain",
		userAgent: "default-agent",
		fallbackUserAgent: overrides.fallbackUserAgent ?? "fallback-agent",
		maxRedirects: 5,
		maxResponseBytes: overrides.maxResponseBytes ?? 1024,
		blockPrivateHosts: overrides.blockPrivateHosts ?? true,
	};
}

async function startServer(
	handler: RequestHandler,
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address !== "object") throw new Error("Invalid server address");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => closeServer(server),
	};
}

async function closeServer(server: Server): Promise<void> {
	server.close();
	await once(server, "close");
}
