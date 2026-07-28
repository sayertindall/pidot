/**
 * pi-toolkit-tilldone — tool
 *
 * Registers the `tilldone` tool. Supported actions:
 *   add    — create one or more tasks (text or texts[])
 *   done   — mark a task done (runs gate if present; only marks done on exit 0)
 *   next   — advance current to done, next idle → inprogress
 *   prev   — move current back to idle, previous → inprogress
 *   list   — show all tasks
 *   clear  — remove all tasks
 *   update — change task text, status, or gate
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isTaskGated, runGate } from "./gates";
import { TillDoneParams } from "./schemas";
import { mutateState, readStateOrEmpty } from "./state";
import type { Task, TaskStatus, TillDoneDetails } from "./types";
import { updateWidget } from "./widget";

const STATUS_ICON: Record<string, string> = {
	idle: "( )",
	inprogress: "(*)",
	done: "(x)",
};

export function registerTillDoneTool(
	pi: ExtensionAPI,
	getSessionId: () => string | undefined,
): void {
	pi.registerTool({
		name: "tilldone",
		label: "TillDone",
		description:
			"Manage the task list. Actions: add (text or texts[] for batch), done (id), next, prev, " +
			"list, clear, update (id + text/status/gate). " +
			"You MUST add tasks before using any other tools when task mode is active. " +
			"Always set a task to inprogress before starting work, and mark it done when finished.",

		promptSnippet:
			"Manage the task list. Actions: add, done, next, prev, list, clear, update. " +
			"You MUST add tasks before using any other tools when task mode is active. " +
			"Always set a task to inprogress before starting work, and mark it done when finished.",

		promptGuidelines: [
			"When task mode is active, call tilldone add before using any other tools.",
			"Set a task to inprogress before starting work on it, and mark it done when finished.",
			"Only one task can be inprogress at a time; advancing a new task auto-pauses the current one.",
			"Use texts[] for batch adding multiple tasks in a single call.",
			'Use the "done" action (not "update") to mark a task complete — this runs the gate if one is defined.',
		],

		parameters: TillDoneParams,

		async execute(
			_toolCallId,
			params,
			signal,
			_onUpdate,
			ctx,
		) {
			const sid = getSessionId();
			if (!sid) {
				return makeResult("list", [], 1, "No session ID available");
			}

			const action = params.action as string;

			switch (action) {
				case "add":
					return handleAdd(sid, params, ctx);
				case "done":
					return handleDone(sid, params, pi, signal, ctx);
				case "next":
					return handleNext(sid, ctx);
				case "prev":
					return handlePrev(sid, ctx);
				case "list":
					return handleList(sid, ctx);
				case "clear":
					return handleClear(sid, ctx);
				case "update":
					return handleUpdate(sid, params, ctx);
				default:
					return makeResult(
						"list",
						[],
						1,
						`Unknown action: ${action}`,
					);
			}
		},
	});
}

// -- Action handlers --------------------------------------------------------

async function handleAdd(
	sid: string,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
) {
	const items: string[] =
		(Array.isArray(params.texts) && params.texts.length > 0
			? (params.texts as string[])
			: typeof params.text === "string"
				? [params.text as string]
				: []);

	if (items.length === 0) {
		return makeResult("add", [], 1, "text or texts required for add");
	}

	const gate = typeof params.gate === "string" ? params.gate : undefined;

	const state = await mutateState(sid, (s) => {
		const added: Task[] = [];
		let id = s.nextId;
		for (const text of items) {
			added.push({ id: id++, text, status: "idle", ...(gate ? { gate } : {}) });
		}
		return {
			...s,
			tasks: [...s.tasks, ...added],
			nextId: id,
		};
	});

	updateWidget(ctx, state);

	const added = state.tasks.slice(-items.length);
	const msg =
		added.length === 1
			? `Added task #${added[0]!.id}: ${added[0]!.text}`
			: `Added ${added.length} tasks: ${added.map((t) => `#${t.id}`).join(", ")}`;

	return makeResult("add", state.tasks, state.nextId, undefined, msg);
}

async function handleDone(
	sid: string,
	params: Record<string, unknown>,
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	const id = typeof params.id === "number" ? params.id : undefined;
	if (id === undefined) {
		return makeResult("done", [], 1, "id required for done");
	}

	// Read to check for gate.
	const state = readStateOrEmpty(sid);
	const task = state.tasks.find((t) => t.id === id);
	if (!task) {
		return makeResult("done", state.tasks, state.nextId, `Task #${id} not found`);
	}

	// Run gate if present.
	if (isTaskGated(task)) {
		const gateResult = await runGate(task.gate!, pi, signal);
		if (!gateResult.passed) {
			return makeResult(
				"done",
				state.tasks,
				state.nextId,
				`Gate failed for #${id}: ${task.gate}\nstdout: ${gateResult.stdout}\nstderr: ${gateResult.stderr}`,
			);
		}
	}

	// Mark done.
	const updated = await mutateState(sid, (s) => {
		const t = s.tasks.find((t2) => t2.id === id);
		if (!t) return undefined;
		t.status = "done";
		return { ...s, tasks: [...s.tasks] };
	});

	updateWidget(ctx, updated);

	return makeResult(
		"done",
		updated.tasks,
		updated.nextId,
		undefined,
		`Task #${id} marked done: ${task.text}`,
	);
}

async function handleNext(sid: string, ctx: ExtensionContext) {
	const state = await mutateState(sid, (s) => {
		const current = s.tasks.find((t) => t.status === "inprogress");

		// Mark current as done.
		if (current) {
			current.status = "done";
		}

		// Find next idle task.
		const next = s.tasks.find((t) => t.status === "idle");
		if (next) {
			next.status = "inprogress";
		}

		return { ...s, tasks: [...s.tasks] };
	});

	updateWidget(ctx, state);

	const active = state.tasks.find((t) => t.status === "inprogress");
	const msg = active
		? `Advanced to #${active.id}: ${active.text}`
		: "All tasks done.";

	return makeResult("next", state.tasks, state.nextId, undefined, msg);
}

async function handlePrev(sid: string, ctx: ExtensionContext) {
	const state = await mutateState(sid, (s) => {
		const currentIdx = s.tasks.findIndex((t) => t.status === "inprogress");
		if (currentIdx === -1) return undefined;

		// Move current back to idle.
		const tasks = s.tasks.map((t) => ({ ...t }));
		tasks[currentIdx] = { ...tasks[currentIdx]!, status: "idle" };

		// Find the most recent non-idle task before current.
		for (let i = currentIdx - 1; i >= 0; i--) {
			if (tasks[i]!.status !== "idle") {
				tasks[i] = { ...tasks[i]!, status: "inprogress" };
				return { ...s, tasks };
			}
		}

		return { ...s, tasks };
	});

	updateWidget(ctx, state);

	const active = state.tasks.find((t) => t.status === "inprogress");
	const msg = active
		? `Moved back to #${active.id}: ${active.text}`
		: "No previous task to activate.";

	return makeResult("prev", state.tasks, state.nextId, undefined, msg);
}

async function handleList(sid: string, ctx: ExtensionContext) {
	const state = readStateOrEmpty(sid);
	updateWidget(ctx, state);

	const text =
		state.tasks.length > 0
			? state.tasks
					.map(
						(t) =>
							`${STATUS_ICON[t.status] ?? "( )"} #${t.id} (${t.status}): ${t.text}`,
					)
					.join("\n")
			: "No tasks defined yet.";

	return makeResult("list", state.tasks, state.nextId, undefined, text);
}

async function handleClear(sid: string, ctx: ExtensionContext) {
	const state = await mutateState(sid, (s) => {
		return { ...s, tasks: [], nextId: 1 };
	});

	updateWidget(ctx, state);

	return makeResult(
		"clear",
		[],
		1,
		undefined,
		`Cleared all tasks.`,
	);
}

async function handleUpdate(
	sid: string,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
) {
	const id = typeof params.id === "number" ? params.id : undefined;
	const text = typeof params.text === "string" ? params.text : undefined;
	const gate = typeof params.gate === "string" ? params.gate : undefined;
	const status = typeof params.status === "string" ? (params.status as TaskStatus) : undefined;

	if (id === undefined || (text === undefined && gate === undefined && status === undefined)) {
		return makeResult("update", [], 1, "id and at least one of text/status/gate required for update");
	}

	let oldText = "";

	const state = await mutateState(sid, (s) => {
		const t = s.tasks.find((t2) => t2.id === id);
		if (!t) return undefined;
		oldText = t.text;
		const tasks = s.tasks.map((t2) => (t2.id === id ? { ...t2 } : t2));
		const updated = tasks.find((t2) => t2.id === id)!;
		if (text !== undefined) updated.text = text;
		if (gate !== undefined) updated.gate = gate || undefined;
		if (status !== undefined) {
			// Enforce single inprogress.
			if (status === "inprogress") {
				for (const t2 of tasks) {
					if (t2.id !== id && t2.status === "inprogress") {
						t2.status = "idle";
					}
				}
			}
			updated.status = status;
		}
		return { ...s, tasks };
	});

	updateWidget(ctx, state);

	const parts: string[] = [];
	if (text !== undefined && oldText !== text) {
		parts.push(`text: "${oldText}" → "${text}"`);
	}
	if (status !== undefined) {
		parts.push(`status → ${status}`);
	}
	if (gate !== undefined) {
		parts.push(`gate: ${gate || "(cleared)"}`);
	}
	const msg = `Updated #${id}: ${parts.join(", ")}`;

	return makeResult("update", state.tasks, state.nextId, undefined, msg);
}

// -- Helpers ----------------------------------------------------------------

function makeResult(
	action: string,
	tasks: Task[],
	nextId: number,
	error?: string,
	text?: string,
): { content: { type: "text"; text: string }[]; details: TillDoneDetails } {
	const details: TillDoneDetails = {
		action,
		tasks,
		nextId,
		...(error ? { error } : {}),
	};
	return {
		content: [{ type: "text", text: text ?? error ?? action }],
		details,
	};
}
