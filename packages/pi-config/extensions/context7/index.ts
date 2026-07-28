/**
 * context7/index.ts
 *
 * Library documentation search via the Context7 API.
 *
 * Tools (LLM-callable):
 *   - search_lib(libraryName)
 *   - lookup_lib(libraryId, query, tokens?)
 *
 * Command namespace: /context7 (search, lookup).
 *
 * Persistent state: bounded TTL cache at
 *   ~/.pi/agent/pi-config/context7/cache/<sha256>.json
 *
 * Principle mapping:
 *   1 TypeBox     — schemas.ts
 *   2 markdown    — N/A
 *   3 session     — N/A (cache is cross-session)
 *   4 widget      — N/A (uses setStatus for activity toasts)
 *   5 debounce    — N/A (cache writes are infrequent)
 *   6 throw/warn  — N/A (no user config to validate)
 *   7 split       — types/schemas/runtime/ui/commands as own files
 *   8 ns          — /context7
 *   9 schemas.ts  — present with full tool schemas
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HELP_TEXT, parseContext7Args } from "./commands";
import { fetchDocs, missingKeyMessage, resolveLibrary } from "./runtime";
import { LookupLibParams, SearchLibParams } from "./schemas";
import { formatDocsText, formatResolveText, renderDocsCall, renderDocsResult, renderSearchCall, renderSearchResult } from "./ui";

export default function context7Extension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "search_lib",
		label: "Search Library",
		description:
			"Find Context7 library IDs by name. Use this first when you need library docs. " +
			"Returns a ranked list of matching libraries with IDs, descriptions, and trust scores. " +
			"Pass the chosen libraryId to lookup_lib.",
		parameters: SearchLibParams,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const { libraryName } = params as { libraryName: string };
			const started = Date.now();
			try {
				const result = await resolveLibrary(libraryName);
				if (result.libraries.length === 0) {
					return {
						content: [{ type: "text" as const, text: `No libraries found matching "${libraryName}".` }],
						details: { ok: true, provider: "context7", count: 0, latencyMs: Date.now() - started },
					};
				}
				return {
					content: [{ type: "text" as const, text: formatResolveText(result.libraries) }],
					details: { ok: true, provider: "context7", count: result.libraries.length, latencyMs: Date.now() - started },
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				const isKeyMissing = msg.startsWith("Missing Context7 API key");
				return {
					content: [{ type: "text" as const, text: isKeyMissing ? missingKeyMessage() : `Context7 error: ${msg}` }],
					details: { ok: false, error: msg },
					isError: true,
				};
			}
		},
		renderCall: renderSearchCall,
		renderResult: renderSearchResult,
	});

	pi.registerTool({
		name: "lookup_lib",
		label: "Lookup Library Docs",
		description:
			"Fetch up-to-date documentation and code examples for a resolved library. " +
			"Requires a libraryId from search_lib. Returns version-specific docs and " +
			"working code examples from official sources.",
		parameters: LookupLibParams,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const { libraryId, query, tokens } = params as { libraryId: string; query: string; tokens?: number };
			const started = Date.now();
			try {
				const result = await fetchDocs(libraryId, query, tokens);
				return {
					content: [{ type: "text" as const, text: formatDocsText(result) }],
					details: {
						ok: true,
						provider: "context7",
						libraryId,
						truncated: result.truncated,
						cacheHit: result.cacheHit,
						latencyMs: Date.now() - started,
					},
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				const isKeyMissing = msg.startsWith("Missing Context7 API key");
				return {
					content: [{ type: "text" as const, text: isKeyMissing ? missingKeyMessage() : `Context7 error: ${msg}` }],
					details: { ok: false, error: msg },
					isError: true,
				};
			}
		},
		renderCall: renderDocsCall,
		renderResult: renderDocsResult,
	});

	pi.registerCommand("context7", {
		description: "Search or lookup library docs (Context7). Usage: /context7 search|lookup ...",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const cmd = parseContext7Args(args);
			switch (cmd.kind) {
				case "search": {
					ctx.ui.notify(`Searching Context7 for "${cmd.libraryName}"...`, "info");
					try {
						const result = await resolveLibrary(cmd.libraryName);
						if (result.libraries.length === 0) {
							ctx.ui.notify(`No libraries found matching "${cmd.libraryName}".`, "warning");
							return;
						}
						const top = result.libraries[0];
						if (!top) return;
						ctx.ui.notify(
							`${result.count} libs · top: ${top.name} (${top.id}) trust ${top.trustScore}/10`,
							"info",
						);
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.ui.notify(`Context7 error: ${msg}`, "error");
					}
					return;
				}
				case "lookup": {
					ctx.ui.notify(`Fetching docs for ${cmd.libraryId}...`, "info");
					try {
						const result = await fetchDocs(cmd.libraryId, cmd.query);
						ctx.ui.notify(
							`Fetched ${result.text.length} chars${result.truncated ? " (truncated)" : ""}${result.cacheHit ? " [cached]" : ""}`,
							"info",
						);
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.ui.notify(`Context7 error: ${msg}`, "error");
					}
					return;
				}
				case "help":
					ctx.ui.notify(HELP_TEXT, "info");
					return;
			}
		},
	});
}
