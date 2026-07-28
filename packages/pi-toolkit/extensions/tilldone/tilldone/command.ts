/**
 * pi-toolkit-tilldone — command
 *
 * /tasks command handler. Subcommands: on, off, status, toggle (default).
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { mutateState, readStateOrEmpty } from "./state";
import { updateWidget } from "./widget";

const STATUS_ICON: Record<string, string> = {
	idle: "( )",
	inprogress: "(*)",
	done: "(x)",
};

export function registerTasksCommand(
	pi: ExtensionAPI,
	getSessionId: () => string | undefined,
): void {
	pi.registerCommand("tasks", {
		description: "Toggle task discipline mode (tilldone)",
		handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
			const sid = getSessionId();
			if (!sid) {
				ctx.ui.notify("No active session.", "error");
				return;
			}

			const action = (args ?? "").trim().toLowerCase();

			switch (action) {
				case "status":
					return showStatus(sid, ctx);
				case "on":
				case "enable":
					return enableTasks(sid, ctx);
				case "off":
				case "disable":
					return disableTasks(sid, ctx);
				case "":
				case "toggle":
					return toggleTasks(sid, ctx);
				default:
					ctx.ui.notify(
						"Usage: /tasks [on|off|toggle|status]",
						"warning",
					);
			}
		},
	});
}

async function showStatus(
	sid: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state = readStateOrEmpty(sid);

	const mode = state.enabled ? "on" : "off";
	const done = state.tasks.filter((t) => t.status === "done").length;
	const inprog = state.tasks.filter((t) => t.status === "inprogress").length;
	const idle = state.tasks.filter((t) => t.status === "idle").length;

	const lines = [
		`task-mode:${mode} | ${state.tasks.length} tasks (${done} done, ${inprog} active, ${idle} idle)`,
	];
	for (const t of state.tasks) {
		const icon = STATUS_ICON[t.status] ?? "( )";
		lines.push(`  ${icon} #${t.id} ${t.text}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

async function enableTasks(
	sid: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state = await mutateState(sid, (s) => {
		if (s.enabled) return undefined;
		return { ...s, enabled: true };
	});

	if (state.enabled) {
		updateWidget(ctx, state);
		ctx.ui.notify(
			"Task mode enabled. Agent must define tasks before working.",
			"info",
		);
	} else {
		ctx.ui.notify("Task mode is already enabled.", "info");
	}
}

async function disableTasks(
	sid: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state = await mutateState(sid, (s) => {
		if (!s.enabled) return undefined;
		return { ...s, enabled: false, tasks: [], nextId: 1 };
	});

	updateWidget(ctx, state);
	ctx.ui.notify("Task mode disabled. Tasks cleared.", "info");
}

async function toggleTasks(
	sid: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state = await mutateState(sid, (s) => {
		if (s.enabled) {
			return { ...s, enabled: false, tasks: [], nextId: 1 };
		} else {
			return { ...s, enabled: true };
		}
	});

	updateWidget(ctx, state);

	if (state.enabled) {
		ctx.ui.notify(
			"Task mode enabled. Agent must define tasks before working.",
			"info",
		);
	} else {
		ctx.ui.notify("Task mode disabled. Tasks cleared.", "info");
	}
}
