/**
 * enhance/commands.ts
 *
 * /enhance subcommand parser. Subcommands:
 *   - on                       → activate (with current preset, if any)
 *   - off                      → deactivate
 *   - preset <name>            → switch to named preset
 *   - list                     → list available presets
 *   - rewrite [text]           → ad-hoc rewrite (no state change)
 *   - help
 *
 * Note: `rewrite` is a user-facing convenience that uses the active
 * preset (or no preset) but never changes the state.
 */

export type EnhanceCommand =
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "preset"; name: string }
	| { kind: "list" }
	| { kind: "rewrite"; text: string }
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

export function parseEnhanceArgs(args: string | undefined): EnhanceCommand {
	const raw = (args ?? "").trim();
	if (!raw) return { kind: "help" };
	const tokens = tokenize(raw);
	const sub = tokens[0]?.toLowerCase();
	switch (sub) {
		case "on":
			return { kind: "on" };
		case "off":
			return { kind: "off" };
		case "preset": {
			const name = tokens.slice(1).join(" ").trim();
			return name ? { kind: "preset", name } : { kind: "help" };
		}
		case "list":
			return { kind: "list" };
		case "rewrite": {
			const text = tokens.slice(1).join(" ").trim();
			return text ? { kind: "rewrite", text } : { kind: "rewrite", text: "" };
		}
		default:
			return { kind: "rewrite", text: raw };
	}
}

export const HELP_TEXT =
	"Usage:\n" +
	"  /enhance on\n" +
	"  /enhance off\n" +
	"  /enhance preset <name>\n" +
	"  /enhance list\n" +
	"  /enhance rewrite [text]\n" +
	"\n" +
	"Or just: /enhance <text>  (rewrite and print)";
