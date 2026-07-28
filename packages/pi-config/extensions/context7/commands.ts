/**
 * context7/commands.ts
 *
 * /context7 subcommand parser. Subcommands:
 *   - search <name>   → run search_lib, print result
 *   - lookup <id>     → run lookup_lib with a query, print result
 *   - help
 *
 * Pure parser, no pi types.
 */

export type Context7Command =
	| { kind: "search"; libraryName: string }
	| { kind: "lookup"; libraryId: string; query: string }
	| { kind: "help" };

function tokenize(value: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (!ch) continue;
		if (quote) {
			if (ch === "\\" && i + 1 < value.length) {
				current += value[i + 1] ?? "";
				i += 1;
				continue;
			}
			if (ch === quote) {
				quote = null;
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current.length > 0) tokens.push(current);
	return tokens;
}

export function parseContext7Args(args: string | undefined): Context7Command {
	const tokens = tokenize((args ?? "").trim());
	const sub = tokens[0]?.toLowerCase();
	const rest = tokens.slice(1);
	switch (sub) {
		case "search": {
			const name = rest.join(" ").trim();
			return name ? { kind: "search", libraryName: name } : { kind: "help" };
		}
		case "lookup": {
			const id = rest[0];
			const query = rest.slice(1).join(" ").trim();
			if (!id || !query) return { kind: "help" };
			return { kind: "lookup", libraryId: id, query };
		}
		default:
			return { kind: "help" };
	}
}

export const HELP_TEXT =
	"Usage:\n" +
	"  /context7 search <library-name>\n" +
	"  /context7 lookup <library-id> <query>\n" +
	"\n" +
	"Tools (LLM-callable): search_lib, lookup_lib";
