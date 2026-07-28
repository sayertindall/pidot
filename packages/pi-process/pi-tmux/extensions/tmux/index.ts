/**
 * pi-tmux — thin wrapper over `pi.exec("tmux", ...)` for the
 * slash-command surface. Tmux is the state; this is the command
 * layer.
 *
 * Actions:
 *   run   — create a named pane (split right) and run a command in it
 *   read  — capture output from a named pane
 *   send  — send keys to a named pane (C-c, Enter, q, etc.)
 *   stop  — kill a named pane
 *   list  — list all managed panes
 *
 * Panes are tagged with `@pi_name` tmux user options for discovery.
 * The tool is disabled when not running inside tmux, or when pi is
 * running inside herdr.
 *
 * DEPENDENCY INJECTION: the `exec` argument is the subprocess call
 * surface. The default is `pi.exec`; tests pass a fake. We use
 * `pi.exec` directly rather than routing through `safeExec` from
 * `pi-process-shared` because tmux is a third-party CLI whose
 * behavior is already bounded by `pi.exec`'s timeout/kill discipline
 * — the additional `safeExec` wrapper would be redundant.
 */

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { capturePane, findPane, listAllPanes } from "./pane-ops";
import type { Exec, PaneInfo, Position, TmuxAction } from "./types";

type ExecFactory = (cmd: string, args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export default function piTmux(pi: ExtensionAPI, deps?: { exec?: ExecFactory }): void {
	const inTmux = !!process.env.TMUX;
	const inHerdr = !!process.env.HERDR_ENV;
	if (!inTmux || inHerdr) {
		return;
	}

	const exec: Exec = deps?.exec ?? (pi.exec.bind(pi) as unknown as Exec);

	let myPaneId: string | null = null;
	let myWindowId: string | null = null;

	// Discover our own pane/window/session on startup.
	pi.on("session_start", async () => {
		try {
			const result = await exec("tmux", [
				"display-message",
				"-p",
				"-t",
				process.env.TMUX_PANE || "",
				"#{pane_id}\t#{window_id}\t#{session_id}",
			]);
			if (result.code === 0) {
				const [paneId, windowId] = result.stdout.trim().split("\t");
				myPaneId = paneId || null;
				myWindowId = windowId || null;
			}
		} catch {
			// Best-effort: tool will surface a clearer error if window
			// target is needed.
		}
	});

	function requireWindowTarget(): string {
		if (!myWindowId) throw new Error("Could not determine current tmux window.");
		return myWindowId;
	}

	pi.registerTool({
		name: "tmux",
		label: "tmux",
		description:
			"Manage tmux panes for long-running processes (dev servers, watchers, etc). " +
			"Actions: run (start command in named pane), read (capture output), send (send keys like C-c), stop (kill pane), list (show panes).",
		promptGuidelines: [
			"Use `tmux` run for long-running processes (dev servers, watchers, builds) instead of `bash`.",
			"Use `bash` only for short-lived commands that complete quickly.",
			"Layout: pi runs on the left. Worker panes are created on the right, stacked vertically. First pane splits right from pi, additional panes automatically stack below existing ones.",
		],
		parameters: Type.Object({
			action: Type.Union(
				(["run", "read", "send", "stop", "list"] as const).map((a) => Type.Literal(a)),
				{ description: "Action to perform" },
			),
			pane: Type.Optional(Type.String({ description: "Pane name (required for run/read/send/stop)" })),
			command: Type.Optional(Type.String({ description: "Shell command to run (for run action)" })),
			keys: Type.Optional(
				Type.String({
					description: "Keys to send, space-separated (for send action). Examples: C-c, Enter, q, y",
				}),
			),
			text: Type.Optional(
				Type.String({
					description: "Literal text to type into the pane (for send action). Sent as-is, no key lookup.",
				}),
			),
			lines: Type.Optional(
				Type.Number({ description: "Scrollback lines to capture (for read action, default: 20)" }),
			),
			restart: Type.Optional(
				Type.Boolean({ description: "Kill existing pane before starting (for run action, default: false)" }),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory (for run action)" })),
			position: Type.Optional(
				Type.Union((["right", "bottom"] as const).map((p) => Type.Literal(p)), {
					description: "Pane position (for run action, default: right)",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { action } = params as { action: TmuxAction; [k: string]: unknown };

			switch (action) {
				case "run": {
					const { pane, command, restart, cwd, position } = params as {
						pane?: string;
						command?: string;
						restart?: boolean;
						cwd?: string;
						position?: Position;
					};
					if (!pane) throw new Error("'pane' is required for run");
					if (!command) throw new Error("'command' is required for run");

					const existing = await findPane(pane, exec, requireWindowTarget());

					// Dead pane → always replace. Alive pane → error unless restart.
					if (existing?.alive && !restart) {
						throw new Error(
							`Pane '${pane}' already exists (running ${existing.command}). Use restart: true to replace it.`,
						);
					}
					if (existing) {
						await exec("tmux", ["kill-pane", "-t", existing.paneId]);
					}

					// Layout: first pane splits right from pi, additional panes
					// stack below existing panes (vertical stack on the right
					// side). Explicit position overrides.
					const allOtherPanes = await listAllPanes(exec, requireWindowTarget(), myPaneId);
					let splitFlag: string;
					let splitTarget: string | null = null;

					if (position === "right") {
						splitFlag = "-h";
					} else if (position === "bottom") {
						splitFlag = "-v";
					} else if (allOtherPanes.length > 0) {
						// Auto: stack below the last existing pane.
						splitFlag = "-v";
						splitTarget = allOtherPanes[allOtherPanes.length - 1]?.paneId ?? null;
					} else {
						// Auto: first pane goes to the right of pi.
						splitFlag = "-h";
					}

					const splitArgs: string[] = ["split-window", "-d", splitFlag, "-P", "-F", "#{pane_id}"];
					splitArgs.push("-t", splitTarget ?? myPaneId ?? requireWindowTarget());
					if (cwd) splitArgs.push("-c", cwd);

					const result = await exec("tmux", splitArgs);
					if (result.code !== 0) throw new Error(`split-window failed: ${result.stderr}`);

					const newPaneId = result.stdout.trim();

					// Tag with name.
					await exec("tmux", ["set-option", "-p", "-t", newPaneId, "@pi_name", pane]);

					// Send command (literal text + Enter).
					await exec("tmux", ["send-keys", "-l", "-t", newPaneId, command]);
					await exec("tmux", ["send-keys", "-t", newPaneId, "Enter"]);

					// Wait briefly and capture initial output.
					await new Promise((r) => setTimeout(r, 1500));
					const initialOutput = await capturePane(newPaneId, 20, exec);

					return {
						content: [
							{
								type: "text",
								text: `Started '${command}' in pane '${pane}' (${newPaneId})\n\n${initialOutput}`,
							},
						],
						details: { action: "run", pane, paneId: newPaneId, command, position: position ?? "right" },
					};
				}

				case "read": {
					const { pane, lines } = params as { pane?: string; lines?: number };
					if (!pane) throw new Error("'pane' is required for read");

					const existing = await findPane(pane, exec, requireWindowTarget());
					if (!existing) throw new Error(`Pane '${pane}' not found. Use action 'list' to see managed panes.`);

					const output = await capturePane(existing.paneId, lines ?? 20, exec);

					const truncation = truncateTail(output, {
						maxLines: DEFAULT_MAX_LINES,
						maxBytes: DEFAULT_MAX_BYTES,
					});

					let text = truncation.content;
					if (truncation.truncated) {
						text = `[Showing last ${truncation.outputLines} of ${truncation.totalLines} lines]\n${text}`;
					}

					return {
						content: [{ type: "text", text }],
						details: { action: "read", pane, alive: existing.alive, command: existing.command },
					};
				}

				case "send": {
					const { pane, keys, text } = params as { pane?: string; keys?: string; text?: string };
					if (!pane) throw new Error("'pane' is required for send");
					if (!keys && !text) throw new Error("'keys' or 'text' is required for send");

					const existing = await findPane(pane, exec, requireWindowTarget());
					if (!existing) throw new Error(`Pane '${pane}' not found.`);

					// Send literal text first (if provided).
					if (text) {
						await exec("tmux", ["send-keys", "-l", "-t", existing.paneId, text]);
					}

					// Then send special keys (if provided).
					if (keys) {
						const keyArgs = keys.split(/\s+/).filter(Boolean);
						await exec("tmux", ["send-keys", "-t", existing.paneId, ...keyArgs]);
					}

					const desc = [text && `"${text}"`, keys].filter(Boolean).join(" + ");
					return {
						content: [{ type: "text", text: `Sent ${desc} to pane '${pane}'` }],
						details: { action: "send", pane, keys, text },
					};
				}

				case "stop": {
					const { pane } = params as { pane?: string };
					if (!pane) throw new Error("'pane' is required for stop");

					const existing = await findPane(pane, exec, requireWindowTarget());
					if (!existing) throw new Error(`Pane '${pane}' not found.`);

					if (existing.paneId === myPaneId) {
						throw new Error("Refusing to kill the pane pi is running in.");
					}

					await exec("tmux", ["kill-pane", "-t", existing.paneId]);

					return {
						content: [{ type: "text", text: `Stopped pane '${pane}'` }],
						details: { action: "stop", pane },
					};
				}

				case "list": {
					const panes = await listAllPanes(exec, requireWindowTarget(), myPaneId);

					if (panes.length === 0) {
						return {
							content: [{ type: "text", text: "No panes (besides pi)." }],
							details: { action: "list", panes: [] },
						};
					}

					const text = panes
						.map((p) => {
							const label = p.name || `[${p.command}]`;
							const managed = p.name ? "" : " (unmanaged)";
							return `${label}: ${p.alive ? "running" : "dead"} (${p.command}) [${p.paneId}]${managed}`;
						})
						.join("\n");

					return {
						content: [{ type: "text", text }],
						details: { action: "list", panes },
					};
				}

				default:
					throw new Error(`Unknown action: ${String(action)}`);
			}
		},

		// --- rendering ---

		renderCall(args, theme) {
			const a = args as { action?: string; pane?: string; command?: string; text?: string; keys?: string };
			const action = a.action || "?";
			let text = theme.fg("toolTitle", theme.bold("tmux "));
			text += theme.fg("accent", action);

			if (a.pane) text += theme.fg("muted", ` ${a.pane}`);
			if (a.command) text += theme.fg("dim", ` › ${a.command}`);
			if (a.text) text += theme.fg("dim", ` › "${a.text}"`);
			if (a.keys) text += theme.fg("dim", ` › ${a.keys}`);

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as Record<string, unknown> | undefined;
			if (!details) {
				const c = result.content?.[0];
				return new Text(c?.type === "text" ? c.text : "", 0, 0);
			}

			switch (details.action) {
				case "run": {
					const pane = String(details.pane ?? "");
					const command = String(details.command ?? "");
					let t = theme.fg("success", `▶ ${pane}`);
					t += theme.fg("dim", ` › ${command}`);
					return new Text(t, 0, 0);
				}

				case "read": {
					const alive = details.alive as boolean | undefined;
					const pane = String(details.pane ?? "");
					const dot = alive ? theme.fg("success", "●") : theme.fg("error", "●");
					let t = `${dot} ${theme.fg("accent", pane)}`;

					if (expanded) {
						const c = result.content?.[0];
						if (c?.type === "text") {
							const outputLines = c.text.split("\n").slice(0, 40);
							t += "\n" + outputLines.map((l: string) => theme.fg("dim", l)).join("\n");
							const total = c.text.split("\n").length;
							if (total > 40) {
								t += `\n${theme.fg("muted", `... (${total} total lines)`)}`;
							}
						}
					}
					return new Text(t, 0, 0);
				}

				case "send": {
					const pane = String(details.pane ?? "");
					const keys = details.keys as string | undefined;
					const text = details.text as string | undefined;
					const desc = [text && `"${text}"`, keys].filter(Boolean).join(" + ");
					return new Text(theme.fg("accent", `⏎ ${pane} › ${desc}`), 0, 0);
				}

				case "stop": {
					const pane = String(details.pane ?? "");
					return new Text(theme.fg("warning", `■ ${pane}`), 0, 0);
				}

				case "list": {
					const panes = details.panes as PaneInfo[] | undefined;
					if (!panes?.length) return new Text(theme.fg("dim", "no panes"), 0, 0);

					const lines = panes.map((p) => {
						const dot = p.alive ? theme.fg("success", "●") : theme.fg("error", "●");
						const label = p.name ? theme.fg("accent", p.name) : theme.fg("muted", `[${p.command}]`);
						const extra = p.name ? "" : theme.fg("dim", " (unmanaged)");
						return `${dot} ${label} ${theme.fg("dim", p.command)}${extra}`;
					});
					return new Text(lines.join("\n"), 0, 0);
				}

				default: {
					const c = result.content?.[0];
					return new Text(c?.type === "text" ? c.text : "", 0, 0);
				}
			}
		},
	});
}
