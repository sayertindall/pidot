/**
 * status/index.ts
 *
 * Custom status footer. One widget key, render-throttled by pi's
 * `setFooter` callback. Persistent state: none — the snapshot is
 * rebuilt from the live session on every render.
 *
 * Principle mapping:
 *   1 TypeBox     — N/A (no persistent state, no tool params)
 *   2 markdown    — N/A
 *   3 session     — N/A (no persistent state)
 *   4 widget      — single setFooter call below
 *   5 debounce    — N/A (no persistence)
 *   6 throw/warn  — N/A
 *   7 split       — types/schemas/runtime/ui/commands as own files
 *   8 ns          — /status (not /statusline)
 *   9 schemas.ts  — present, even if empty (discoverability)
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseStatusArgs } from "./commands";
import { buildSnapshot } from "./runtime";
import { renderStatusLine } from "./ui";

export default function statusExtension(pi: ExtensionAPI): void {
	let hidden = false;

	function setFooter(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (hidden) {
			ctx.ui.setFooter(undefined);
			return;
		}
		ctx.ui.setFooter((_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const snap = buildSnapshot(pi, ctx);
				return renderStatusLine(snap, width, theme);
			},
		}));
	}

	pi.on("session_start", (_event, ctx) => {
		setFooter(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setFooter(undefined);
	});

	pi.registerCommand("status", {
		description: "Show or hide the status footer. Usage: /status [on|off|refresh|toggle]",
		handler: async (args, ctx) => {
			const cmd = parseStatusArgs(args);
			switch (cmd.kind) {
				case "toggle":
					hidden = !hidden;
					break;
				case "set":
					hidden = cmd.hidden;
					break;
				case "refresh":
					break;
				case "help":
					if (ctx.hasUI) {
						ctx.ui.notify("Usage: /status [on|off|refresh|toggle]", "info");
					}
					return;
			}
			setFooter(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(hidden ? "Status hidden" : "Status shown", "info");
			}
		},
	});
}
