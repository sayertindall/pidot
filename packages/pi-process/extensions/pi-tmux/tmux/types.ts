/**
 * pi-tmux/types.ts
 *
 * Types for the tmux tool. The tool's `action` is a string union
 * over the 5 supported operations; `PaneInfo` is the
 * `tmux list-panes` parsed record; `Position` is the optional
 * `run` action's split-window direction.
 */

export type TmuxAction = "run" | "read" | "send" | "stop" | "list";

export type PaneInfo = {
	name: string;
	paneId: string;
	alive: boolean;
	command: string;
	pid: string;
};

export type Position = "right" | "bottom";

/**
 * Subprocess call signature. `pi.exec` returns `{code, stdout, stderr,
 * killed, signal}`; we only need the first three, so the type is
 * narrowed here. Tests inject a fake that satisfies this contract.
 */
export type Exec = (
	command: string,
	args: readonly string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;
