/**
 * context7/ui.ts
 *
 * Tool result renderers. Compact (one-line) and expanded (multi-line)
 * variants, following the same pattern as the other extensions.
 */
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsResult, Library } from "./types";
import { truncateForDisplay } from "./runtime";

type Content = TextContent | ImageContent;

type RenderResult = {
	isError?: boolean;
	content?: Content[];
	details?: unknown;
};

type RenderOptions = { expanded: boolean; isPartial: boolean };

export function renderSearchCall(args: unknown, theme: Theme): Text {
	const a = args as { libraryName?: unknown };
	const name = typeof a.libraryName === "string" ? a.libraryName : "...";
	return new Text(
		`${theme.fg("toolTitle" as ThemeColor, theme.bold("Context7 Resolve"))} ${theme.fg("accent" as ThemeColor, name)}`,
		0,
		0,
	);
}

export function renderSearchResult(
	result: RenderResult,
	options: RenderOptions,
	theme: Theme,
): Text {
	if (options.isPartial) {
		return new Text(
			`${theme.fg("accent" as ThemeColor, "⏳")} ${theme.fg("thinkingText" as ThemeColor, "Resolving...")}`,
			0,
			0,
		);
	}
	const details = result.details as { ok?: boolean; count?: number } | undefined;
	if (!details?.ok) {
		return new Text(
			`${theme.fg("error" as ThemeColor, "✗")} ${theme.fg("muted" as ThemeColor, "◇ Context7 resolve error")}`,
			0,
			0,
		);
	}
	if (!options.expanded) {
		return new Text(
			`${theme.fg("success" as ThemeColor, "✓")} ${theme.fg("toolTitle" as ThemeColor, "◇ Context7 resolve")} ${theme.fg("muted" as ThemeColor, `${details.count ?? 0} results`)}`,
			0,
			0,
		);
	}
	const text = firstText(result) ?? "(no results)";
	return new Text(
		`${theme.fg("success" as ThemeColor, "✓")} ${theme.fg("toolTitle" as ThemeColor, "◇ Context7 resolve")}\n${theme.fg("muted" as ThemeColor, text)}`,
		0,
		0,
	);
}

export function renderDocsCall(args: unknown, theme: Theme): Text {
	const a = args as { libraryId?: unknown; query?: unknown };
	const id = typeof a.libraryId === "string" ? a.libraryId : "...";
	const query = typeof a.query === "string" ? a.query : "";
	const preview = query.length > 50 ? `${query.slice(0, 49)}…` : query;
	return new Text(
		`${theme.fg("toolTitle" as ThemeColor, theme.bold("Context7 Docs"))} ${theme.fg("accent" as ThemeColor, id)} ${theme.fg("dim" as ThemeColor, `— ${preview}`)}`,
		0,
		0,
	);
}

export function renderDocsResult(
	result: RenderResult,
	options: RenderOptions,
	theme: Theme,
): Text {
	if (options.isPartial) {
		return new Text(
			`${theme.fg("accent" as ThemeColor, "⏳")} ${theme.fg("thinkingText" as ThemeColor, "Fetching docs...")}`,
			0,
			0,
		);
	}
	const details = result.details as
		| { ok?: boolean; libraryId?: string; truncated?: boolean; cacheHit?: boolean }
		| undefined;
	if (!details?.ok) {
		return new Text(
			`${theme.fg("error" as ThemeColor, "✗")} ${theme.fg("muted" as ThemeColor, "◇ Context7 docs error")}`,
			0,
			0,
		);
	}
	if (!options.expanded) {
		const suffix = details.truncated ? theme.fg("warning" as ThemeColor, " (truncated)") : "";
		const hit = details.cacheHit ? theme.fg("dim" as ThemeColor, " [cached]") : "";
		return new Text(
			`${theme.fg("success" as ThemeColor, "✓")} ${theme.fg("toolTitle" as ThemeColor, "◇ Context7 docs")} ${theme.fg("accent" as ThemeColor, details.libraryId ?? "")}${suffix}${hit}`,
			0,
			0,
		);
	}
	const text = firstText(result) ?? "(no results)";
	const display = truncateForDisplay(text, 2000);
	return new Text(
		`${theme.fg("success" as ThemeColor, "✓")} ${theme.fg("toolTitle" as ThemeColor, "◇ Context7 docs")} ${theme.fg("accent" as ThemeColor, details.libraryId ?? "")}\n${theme.fg("muted" as ThemeColor, display)}`,
		0,
		0,
	);
}

function firstText(result: RenderResult): string | undefined {
	const c = result.content?.[0];
	return c?.type === "text" ? c.text : undefined;
}

export function formatResolveText(libs: Library[]): string {
	if (libs.length === 0) return "No libraries found.";
	return libs
		.map(
			(lib, i) =>
				`${i + 1}. ${lib.name} (id: ${lib.id})\n` +
				`   Trust: ${lib.trustScore}/10 | Snippets: ${lib.totalSnippets}\n` +
				`   ${lib.description}`,
		)
		.join("\n\n");
}

export function formatDocsText(result: DocsResult): string {
	let text = result.text;
	if (result.truncated) {
		text +=
			"\n\n[Output truncated. Narrow your query or pass a higher `tokens` value " +
			"for more specific results.]";
	}
	return text;
}
