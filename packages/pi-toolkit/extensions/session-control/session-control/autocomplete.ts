/**
 * autocomplete.ts — session: prefix autocomplete
 *
 * Augments the editor's autocomplete to suggest live sessions when the
 * user types "session:". Delegates non-session prefixes to the existing
 * autocomplete provider.
 */

import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { getLiveSessions } from "./registry";
import type { LiveSessionInfo } from "./types";

function extractSessionToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[\s("'`])session:([^\s]*)$/i);
	return match?.[1];
}

function formatItem(session: LiveSessionInfo): AutocompleteItem {
	const aliases = session.aliases.filter((a) => a !== session.name);
	const aliasSummary =
		aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : "";
	const label = session.name
		? `session:${session.name}`
		: `session:${session.sessionId}`;
	return {
		value: label,
		label,
		description: `${session.sessionId}${aliasSummary}`,
	};
}

export function createSessionAutocompleteProvider(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
			options,
		): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);
			const token = extractSessionToken(textBeforeCursor);
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const sessions = await getLiveSessions();
			if (options.signal.aborted || sessions.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const items = fuzzyFilter(
				sessions,
				token,
				(s) =>
					`${s.name ?? ""} ${s.sessionId} ${s.aliases.join(" ")}`,
			)
				.slice(0, 20)
				.map(formatItem);

			if (items.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				items,
				prefix: `session:${token}`,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
			);
		},
	};
}
