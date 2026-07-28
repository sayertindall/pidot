/**
 * /safety command.
 *
 * Subcommands (one slash root — principle 8):
 *   /safety list               — show active rules
 *   /safety test <command>     — test if a bash command would be blocked
 *   /safety test-write <path>  — test if a write to a path would be blocked
 *   /safety reload             — re-read safety.json from disk
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { checkBash, checkWriteOrEdit } from "./matchers";
import type { SafetyConfig } from "./types";

export type SafetyCommand =
	| { verb: "list" }
	| { verb: "test-bash"; command: string }
	| { verb: "test-write"; path: string; content?: string }
	| { verb: "reload" };

export function parseSafetyCommand(args: string): SafetyCommand {
	const trimmed = args.trim();
	if (trimmed === "") return { verb: "list" };
	const [verb, ...rest] = trimmed.split(/\s+/);
	if (verb === "list") return { verb: "list" };
	if (verb === "reload") return { verb: "reload" };
	if (verb === "test" && rest[0]) {
		// `test foo` → bash. `test --write PATH [CONTENT]` → write.
		if (rest[0] === "--write" || rest[0] === "-w") {
			return { verb: "test-write", path: rest[1] ?? "", content: rest.slice(2).join(" ") || undefined };
		}
		return { verb: "test-bash", command: rest.join(" ") };
	}
	return { verb: "test-bash", command: trimmed };
}

export function formatSafetyList(cfg: SafetyConfig): string[] {
	const lines: string[] = [];
	lines.push(`version: ${cfg.version}`);
	lines.push(`bash.blockPatterns: ${cfg.bash.blockPatterns.length}`);
	for (const p of cfg.bash.blockPatterns) lines.push(`  - "${p.pattern}" — ${p.reason}`);
	lines.push(`paths.readOnly: ${cfg.paths.readOnly.length}`);
	for (const p of cfg.paths.readOnly) lines.push(`  - ${p}`);
	lines.push(`paths.noDelete: ${cfg.paths.noDelete.length}`);
	for (const p of cfg.paths.noDelete) lines.push(`  - ${p}`);
	lines.push(`credentials.blockPatterns: ${cfg.credentials.blockPatterns.length}`);
	for (const p of cfg.credentials.blockPatterns) lines.push(`  - ${p}`);
	lines.push(`credentials.blockFiles: ${cfg.credentials.blockFiles.length}`);
	for (const p of cfg.credentials.blockFiles) lines.push(`  - ${p}`);
	return lines;
}

export function registerSafetyCommand(
	pi: ExtensionAPI,
	getConfig: () => SafetyConfig,
	reload: () => SafetyConfig,
): void {
	pi.registerCommand("safety", {
		description: "Manage safety rules. Subcommands: list, test <command>, test --write <path>, reload",
		handler: async (args, ctx) => {
			const cmd = parseSafetyCommand(args ?? "");
			switch (cmd.verb) {
				case "list": {
					const lines = formatSafetyList(getConfig());
					notify(ctx, lines.join("\n"), "info");
					return;
				}
				case "reload": {
					const next = reload();
					notify(ctx, `Safety: reloaded. version=${next.version}`, "info");
					return;
				}
				case "test-bash": {
					const reason = checkBash(cmd.command, getConfig());
					notify(
						ctx,
						reason ? `BLOCKED: ${reason}` : "ALLOWED",
						reason ? "warning" : "info",
					);
					return;
				}
				case "test-write": {
					const reason = checkWriteOrEdit(cmd.path, cmd.content, getConfig());
					notify(
						ctx,
						reason ? `BLOCKED: ${reason}` : "ALLOWED",
						reason ? "warning" : "info",
					);
					return;
				}
			}
		},
	});
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}
