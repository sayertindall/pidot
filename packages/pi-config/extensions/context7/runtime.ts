/**
 * context7/runtime.ts
 *
 * HTTP client + bounded-text truncation + file cache. Stateless except
 * for the on-disk cache directory at
 *   ~/.pi/agent/pi-config/context7/cache/<sha256>.json
 *
 * Cache TTL: 1h. Reads are checked against `savedAt`; expired entries
 * are treated as misses and re-fetched.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { CachedEntry, DocsResult, Library, ResolveResult } from "./types";

const BASE_URL = "https://context7.com/api";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type ApiResolveResponse = {
	results: Array<{
		id: string;
		title?: string;
		name?: string;
		description: string;
		totalSnippets: number;
		trustScore: number;
		versions?: string[];
	}>;
};

function loadApiKey(): string | null {
	const settingsPath = join(getAgentDir(), "settings.json");
	if (existsSync(settingsPath)) {
		try {
			const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as {
				context7?: { apiKey?: unknown };
			};
			const key = raw.context7?.apiKey;
			if (typeof key === "string" && key) return key;
		} catch {
			// fall through to env
		}
	}
	const env = process.env.CONTEXT7_API_KEY;
	return typeof env === "string" && env ? env : null;
}

function cacheDir(): string {
	return join(getAgentDir(), "pi-config", "context7", "cache");
}

function cachePath(key: string): string {
	const hash = createHash("sha256").update(key).digest("hex");
	return join(cacheDir(), `${hash}.json`);
}

function readCache<T>(key: string, now: number): T | undefined {
	const path = cachePath(key);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as CachedEntry<T>;
		if (now - parsed.savedAt > CACHE_TTL_MS) return undefined;
		return parsed.value;
	} catch {
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			renameSync(path, `${path}.corrupt-${stamp}`);
		} catch {
			// best effort
		}
		return undefined;
	}
}

function writeCache<T>(key: string, value: T): void {
	const path = cachePath(key);
	mkdirSync(cacheDir(), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), value }, null, "\t"));
	renameSync(tmp, path);
}

async function apiGet<T>(
	endpoint: string,
	params: Record<string, string | number | undefined>,
	apiKey: string,
): Promise<T> {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined) qs.append(k, String(v));
	}
	const res = await fetch(`${BASE_URL}/${endpoint}?${qs}`, {
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Context7 API ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

export function missingKeyMessage(): string {
	return (
		"Missing Context7 API key.\n" +
		"Set it in ~/.pi/agent/settings.json under \"context7.apiKey\", or set CONTEXT7_API_KEY env var.\n" +
		"Get a free key at https://context7.com/dashboard"
	);
}

export async function resolveLibrary(libraryName: string): Promise<ResolveResult> {
	const apiKey = loadApiKey();
	if (!apiKey) throw new Error(missingKeyMessage());

	const cacheKey = `resolve:${libraryName}`;
	const cached = readCache<ResolveResult>(cacheKey, Date.now());
	if (cached) return { ...cached, latencyMs: 0 };

	const started = Date.now();
	const data = await apiGet<ApiResolveResponse>(
		"v2/libs/search",
		{ query: libraryName, libraryName },
		apiKey,
	);
	const result: ResolveResult = {
		libraries: data.results.map(
			(r): Library => ({
				id: r.id,
				name: r.title || r.name || r.id,
				description: r.description,
				totalSnippets: r.totalSnippets,
				trustScore: r.trustScore,
				versions: r.versions,
			}),
		),
		provider: "context7",
		latencyMs: Date.now() - started,
		count: data.results.length,
	};
	writeCache(cacheKey, result);
	return result;
}

export async function fetchDocs(
	libraryId: string,
	query: string,
	tokens?: number,
): Promise<DocsResult> {
	const apiKey = loadApiKey();
	if (!apiKey) throw new Error(missingKeyMessage());

	const cacheKey = `docs:${libraryId}:${query}:${tokens ?? 0}`;
	const cached = readCache<DocsResult>(cacheKey, Date.now());
	if (cached) return { ...cached, cacheHit: true };

	const started = Date.now();
	const qs = new URLSearchParams({ query, libraryId, type: "txt" });
	if (tokens !== undefined) qs.append("tokens", String(tokens));

	const res = await fetch(`${BASE_URL}/v2/context?${qs}`, {
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Context7 API ${res.status}: ${body}`);
	}
	const raw = await res.text();
	const trunc = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	const result: DocsResult = {
		libraryId,
		text: trunc.content,
		truncated: trunc.truncated,
		provider: "context7",
		latencyMs: Date.now() - started,
		cacheHit: false,
	};
	writeCache(cacheKey, result);
	return result;
}

export function truncateForDisplay(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n…(truncated in TUI)`;
}
