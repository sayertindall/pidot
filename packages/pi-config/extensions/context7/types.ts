/**
 * context7/types.ts
 *
 * In-memory types for the context7 library-doc search extension. Two
 * tools: `search_lib` (find libraries) and `lookup_lib` (fetch docs).
 *
 * Persistent state: a 1h TTL cache at
 *   ~/.pi/agent/pi-config/context7/cache/<sha256(query)>.json
 *
 * API key is read from `~/.pi/agent/settings.json` (context7.apiKey)
 * or the `CONTEXT7_API_KEY` env var.
 */

export type Library = {
	id: string;
	name: string;
	description: string;
	totalSnippets: number;
	trustScore: number;
	versions?: string[];
};

export type ResolveResult = {
	libraries: Library[];
	provider: "context7";
	latencyMs: number;
	count: number;
};

export type DocsResult = {
	libraryId: string;
	text: string;
	truncated: boolean;
	provider: "context7";
	latencyMs: number;
	cacheHit: boolean;
};

export type CachedEntry<T> = {
	readonly savedAt: number;
	readonly value: T;
};
