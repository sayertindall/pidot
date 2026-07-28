/**
 * pi-tmux/pane-ops.ts
 *
 * Pure helpers for the tmux tool. The exec dependency is injected
 * via the second argument; the extension factory closes over its
 * real `pi.exec` and tests pass a fake.
 *
 * No state, no `pi.exec` calls at module load time. Everything is a
 * pure function of (params, exec, currentPaneId, currentWindowId).
 */

import type { Exec, PaneInfo } from "./types";

/**
 * Strip ANSI escapes, OSC sequences, and tmux/wezterm wrapping so
 * captured output is human-readable.
 */
export function stripAnsi(text: string): string {
	return (
		text
			// OSC sequences (e.g. \x1b]...\x07 or \x1b]...\x1b\\)
			.replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "")
			// tmux passthrough (\x1bPtmux;...\x1b\\)
			.replace(/\x1bPtmux;.*?\x1b\\/g, "")
			// CSI sequences (\x1b[...letter)
			.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
			// Remaining bare escapes
			.replace(/\x1b[^[\]P]/g, "")
			// Carriage returns (terminal rewrite lines)
			.replace(/\r/g, "")
	);
}

/**
 * Find a pane by `@pi_name` user option in the current window.
 * Returns null if not found.
 */
export async function findPane(
	name: string,
	exec: Exec,
	windowTarget: string,
): Promise<PaneInfo | null> {
	const result = await exec("tmux", [
		"list-panes",
		"-t",
		windowTarget,
		"-F",
		"#{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
	]);
	if (result.code !== 0) return null;

	for (const line of result.stdout.trim().split("\n")) {
		const [paneId, paneName, command, pid, dead] = line.split("\t");
		if (paneName === name) {
			return {
				name: paneName,
				paneId: paneId ?? "",
				alive: dead !== "1",
				command: command ?? "",
				pid: pid ?? "",
			};
		}
	}
	return null;
}

/**
 * List all managed panes in the current window, excluding pi's
 * own pane. Pass `myPaneId` to filter; pass null on first call
 * (before session_start has discovered it) to list everything.
 */
export async function listAllPanes(
	exec: Exec,
	windowTarget: string,
	myPaneId: string | null,
): Promise<PaneInfo[]> {
	const result = await exec("tmux", [
		"list-panes",
		"-t",
		windowTarget,
		"-F",
		"#{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
	]);
	if (result.code !== 0) return [];

	const panes: PaneInfo[] = [];
	for (const line of result.stdout.trim().split("\n")) {
		if (!line.trim()) continue;
		const [paneId, paneName, command, pid, dead] = line.split("\t");
		// Skip pi's own pane.
		if (myPaneId && paneId === myPaneId) continue;
		panes.push({
			name: paneName?.trim() ?? "",
			paneId: paneId ?? "",
			alive: dead !== "1",
			command: command ?? "",
			pid: pid ?? "",
		});
	}
	return panes;
}

/**
 * Capture the last `lines` of a pane. Returns the rendered text
 * with ANSI escapes stripped and trailing blank lines trimmed.
 */
export async function capturePane(
	paneId: string,
	lines: number,
	exec: Exec,
): Promise<string> {
	const result = await exec("tmux", ["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]);
	if (result.code !== 0) throw new Error(`capture-pane failed: ${result.stderr}`);

	let output = stripAnsi(result.stdout);
	// Trim trailing blank lines (tmux pads to pane height).
	output = output.replace(/\n+$/, "\n");
	return output;
}
