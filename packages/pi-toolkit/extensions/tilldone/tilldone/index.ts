/**
 * pi-toolkit-tilldone — index
 *
 * Extension factory. Wires:
 *   - /tasks command
 *   - tilldone tool
 *   - session_start → restore state + update widget
 *   - before_agent_start → block if gates not satisfied
 *   - agent_end → auto-nudge on incomplete tasks
 *   - input → reset nudge flag
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTasksCommand } from "./command";
import { shouldBlockAgentStart } from "./gates";
import { readStateOrEmpty, mutateState } from "./state";
import { registerTillDoneTool } from "./tool";
import { formatTaskList, updateWidget } from "./widget";

export default function tilldoneExtension(pi: ExtensionAPI): void {
	let sessionId: string | undefined;
	let nudgedThisCycle = false;

	const getSessionId = () => sessionId;

	// -- Tool registration ---------------------------------------------------

	registerTillDoneTool(pi, getSessionId);
	registerTasksCommand(pi, getSessionId);

	// -- Session lifecycle ---------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		const state = readStateOrEmpty(sessionId);
		updateWidget(ctx, state);
	});

	pi.on("session_tree", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		const state = readStateOrEmpty(sessionId);
		updateWidget(ctx, state);
	});

	// -- Blocking gate: before_agent_start -----------------------------------

	pi.on("before_agent_start", async () => {
		if (!sessionId) return undefined;
		const state = await mutateState(sessionId, (s) => s);
		if (!state.enabled) return undefined;

		const block = shouldBlockAgentStart(state);
		if (block.block) {
			// Inject a system message that explains the block.
			return {
				message: {
					customType: "tilldone-block",
					content: block.reason!,
					display: false,
				},
			};
		}

		// Inject task context.
		const taskList = formatTaskList(state);
		return {
			message: {
				customType: "tilldone-context",
				content:
					`[TASK MODE ACTIVE]\nYou have a task list managed by the tilldone tool. Current tasks:\n\n${taskList}\n\n` +
					`Rules:\n` +
					`- Always set a task to inprogress before starting work on it.\n` +
					`- Mark tasks done when finished (use "done" action to run any gate).\n` +
					`- Only one task can be inprogress at a time.\n` +
					`- Work through tasks systematically.`,
				display: false,
			},
		};
	});

	// -- Auto-nudge on agent_end ---------------------------------------------

	pi.on("agent_end", async () => {
		if (!sessionId) return;
		if (nudgedThisCycle) return;

		const state = await mutateState(sessionId, (s) => s);
		if (!state.enabled) return;

		const incomplete = state.tasks.filter((t) => t.status !== "done");
		if (incomplete.length === 0) return;

		nudgedThisCycle = true;

		const taskList = incomplete
			.map((t) => {
				const icon = t.status === "inprogress" ? "(*)" : "( )";
				return `  ${icon} #${t.id} (${t.status}): ${t.text}`;
			})
			.join("\n");

		pi.sendMessage(
			{
				customType: "tilldone-nudge",
				content: `You still have ${incomplete.length} incomplete task(s):\n\n${taskList}\n\nContinue working on them or mark them done with tilldone done.`,
				display: true,
			},
			{ triggerTurn: true },
		);
	});

	pi.on("input", async () => {
		nudgedThisCycle = false;
		return { action: "continue" as const };
	});
}
