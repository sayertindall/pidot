/**
 * status/commands.ts
 *
 * /status subcommand parser. Subcommands:
 *   - (no args)  → toggle visibility
 *   - on         → show
 *   - off        → hide
 *   - refresh    → force re-render (no-op trigger)
 *
 * No TypeBox schema: no params flow into pi internals.
 */

export type StatusCommand =
	| { kind: "toggle" }
	| { kind: "set"; hidden: boolean }
	| { kind: "refresh" }
	| { kind: "help" };

export function parseStatusArgs(args: string | undefined): StatusCommand {
	const trimmed = args?.trim().toLowerCase() ?? "";
	if (trimmed === "" || trimmed === "toggle") return { kind: "toggle" };
	if (trimmed === "on" || trimmed === "show") return { kind: "set", hidden: false };
	if (trimmed === "off" || trimmed === "hide") return { kind: "set", hidden: true };
	if (trimmed === "refresh") return { kind: "refresh" };
	return { kind: "help" };
}
