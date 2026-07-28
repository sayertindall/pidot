/**
 * review/commands.ts
 *
 * /review subcommand parser. Subcommands:
 *   - (no args)              → interactive selector
 *   - uncommitted            → review uncommitted changes
 *   - branch <name>          → diff against base branch
 *   - commit <sha> [title]   → review one commit
 *   - pr <ref>               → review a pull request
 *   - status                 → show current review state
 *   - cancel                 → mark current review cancelled
 *   - help
 *
 * `cancel` is a polite stop: it sets the state to `cancelled` and clears
 * the widget. The actual forked session, if any, must be handled by the
 * caller (we don't have a handle to it from the parser).
 */

export type ReviewCommand =
	| { kind: "uncommitted"; extra?: string }
	| { kind: "branch"; branch: string; extra?: string }
	| { kind: "commit"; sha: string; title?: string; extra?: string }
	| { kind: "pr"; ref: string; extra?: string }
	| { kind: "status" }
	| { kind: "cancel" }
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

export function parseReviewArgs(args: string | undefined): ReviewCommand {
	const raw = (args ?? "").trim();
	if (raw.length === 0) return { kind: "help" };

	// --extra consumes the rest of the input (the user's note for the
	// reviewer can be a free-form sentence with spaces). When it
	// appears as --extra=<value>, the value is everything after `=`.
	// When it appears as --extra <value...>, the value is everything
	// from that word to the end of the input.
	let extraInstruction: string | undefined;
	let head = raw;
	const extraEqMatch = /(^|\s)--extra=(\S.*)$/.exec(raw);
	if (extraEqMatch && extraEqMatch[2] !== undefined) {
		extraInstruction = extraEqMatch[2].trim();
		head = raw.slice(0, extraEqMatch.index) + (raw[extraEqMatch.index ?? 0] === " " ? " " : "");
		head = head.trim();
	} else {
		const extraMatch = /(^|\s)--extra(\s+.*)?$/.exec(raw);
		if (extraMatch) {
			const after = extraMatch[2];
			if (after && after.trim().length > 0) extraInstruction = after.trim();
			const cutAt = (extraMatch.index ?? 0) + (extraMatch[1]?.length ?? 0);
			head = raw.slice(0, cutAt).trim();
		}
	}

	const tokens = tokenize(head);
	if (tokens.length === 0) return { kind: "help" };

	const sub = tokens[0]?.toLowerCase();
	const rest = tokens.slice(1);

	switch (sub) {
		case "uncommitted":
			return { kind: "uncommitted", extra: extraInstruction };
		case "branch": {
			const branch = rest[0];
			if (!branch) return { kind: "help" };
			return { kind: "branch", branch, extra: extraInstruction };
		}
		case "commit": {
			const sha = rest[0];
			if (!sha) return { kind: "help" };
			const title = rest.slice(1).join(" ") || undefined;
			return { kind: "commit", sha, title, extra: extraInstruction };
		}
		case "pr": {
			const ref = rest[0];
			if (!ref) return { kind: "help" };
			return { kind: "pr", ref, extra: extraInstruction };
		}
		case "status":
			return { kind: "status" };
		case "cancel":
			return { kind: "cancel" };
		default:
			return { kind: "help" };
	}
}

export const HELP_TEXT =
	"Usage:\n" +
	"  /review                              (interactive selector)\n" +
	"  /review uncommitted\n" +
	"  /review branch <name>\n" +
	"  /review commit <sha> [title]\n" +
	"  /review pr <number|url>\n" +
	"  /review status\n" +
	"  /review cancel\n" +
	"\n" +
	"Optional flag: --extra \"additional review instruction\"";
