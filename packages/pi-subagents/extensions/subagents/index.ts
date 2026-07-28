/**
 * index.ts
 *
 * Extension factory. Registers the three model-invoked tools (Agent,
 * get_subagent_result, steer_subagent), the /agents command, the widget,
 * and session lifecycle wiring. Wiring only -- lifecycle logic lives in
 * runtime.ts (AgentManager), scheduling in schedule.ts, grouped-completion
 * batching in group-join.ts. See SUB-SPEC-v4.md §4, §7, §8.
 *
 * Not ported from the reference for this pass: the `/agents` fleet-list
 * picker, schedule-menu, and conversation-viewer overlays (ui.ts already
 * documents this trim), and in-tool schedule creation (the reference's
 * Agent tool accepts a `...scheduleParam` spread to schedule a spawn
 * directly; here scheduling is reachable only through SubagentScheduler's
 * own API, not yet exposed as a tool param). /agents prints a plain-text
 * summary instead of opening a picker.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GroupJoinManager } from "./group-join.ts";
import { AgentManager, resolveAgentConfig } from "./runtime.ts";
import { SubagentScheduler } from "./schedule.ts";
import { ScheduleStore, resolveStorePath } from "./state.ts";
import { SUBAGENT_TOOL_NAMES } from "./types.ts";
import type { AgentRecord, IsolationMode, ThinkingLevel } from "./types.ts";
import { setupAgentWidget } from "./ui.ts";

function text(s: string): TextContent[] {
	return [{ type: "text", text: s }];
}

function toolResult(content: string, details: unknown = {}): AgentToolResult<unknown> {
	return { content: text(content), details };
}

function summarize(record: AgentRecord): string {
	const durationMs = (record.completedAt ?? Date.now()) - record.startedAt;
	const seconds = Math.round(durationMs / 1000);
	const status = record.status;
	const preview = (record.result ?? record.error ?? "").slice(0, 400);
	return `[${record.id}] ${record.type} — ${status} (${seconds}s, ${record.toolUses} tool uses)\n${preview}`;
}

/** Simple "provider/id" resolution only -- no fuzzy name matching (e.g. "haiku" alone
 * isn't resolved). Revisit alongside a real model-resolver module if that's needed. */
function resolveModelString(ctx: ExtensionContext, model: string | undefined) {
	if (!model) return undefined;
	const slash = model.indexOf("/");
	if (slash === -1) return undefined;
	const provider = model.slice(0, slash);
	const modelId = model.slice(slash + 1);
	return ctx.modelRegistry.find(provider, modelId) ?? undefined;
}

export default function subagentsExtension(pi: ExtensionAPI): void {
	const groupJoin = new GroupJoinManager((records, partial) => {
		const lines = records.map(summarize).join("\n\n");
		pi.sendMessage(
			{
				customType: "pi-subagents-group-completion",
				content: text(`${records.length} background agent${records.length === 1 ? "" : "s"} ${partial ? "finished (partial batch)" : "finished"}:\n\n${lines}`),
				display: true,
				details: { agentIds: records.map((r) => r.id), partial },
			},
			{ triggerTurn: true },
		);
	});

	const manager = new AgentManager((record) => {
		if (!record.isBackground || record.resultConsumed) return;
		const verdict = groupJoin.onAgentComplete(record);
		if (verdict !== "pass") return; // "held": waiting on the rest of the group. "delivered": groupJoin's callback just fired.
		pi.sendMessage(
			{
				customType: "pi-subagents-completion",
				content: text(`Background agent finished:\n\n${summarize(record)}`),
				display: true,
				details: { agentId: record.id, status: record.status },
			},
			{ triggerTurn: true },
		);
	});

	const scheduler = new SubagentScheduler();
	let clearWidget: (() => void) | null = null;

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		manager.clearCompleted(true);
		const sessionId = ctx.sessionManager.getSessionId();
		const store = new ScheduleStore(resolveStorePath(ctx.cwd, sessionId));
		scheduler.start(pi, ctx, manager, store);
		clearWidget = setupAgentWidget(ctx, manager);
	});

	pi.on("session_shutdown", async () => {
		scheduler.stop();
		clearWidget?.();
		clearWidget = null;
		manager.dispose();
	});

	pi.registerTool({
		name: SUBAGENT_TOOL_NAMES.AGENT,
		label: "Agent",
		description:
			"Launch an autonomous subagent for a complex multi-step task, or resume a prior one. " +
			"Runs in-process against a fresh (or, with inherit_context, forked) conversation. " +
			"Use for parallelizable research/search work or to protect the main context window from excessive results.",
		promptSnippet: "Launch or resume an autonomous subagent",
		parameters: Type.Object({
			prompt: Type.String({ description: "The task for the agent to perform." }),
			description: Type.String({ description: "A short (3-5 word) description of the task, shown in the UI." }),
			subagent_type: Type.Optional(
				Type.String({
					description: 'The type of specialized agent to use, e.g. "general-purpose", "Explore", "Plan", or a custom name from .pi/agents/*.md. Required unless `resume` is set.',
				}),
			),
			resume: Type.Optional(Type.String({ description: "Agent ID to resume instead of spawning a new agent. Continues the same session with a new prompt." })),
			model: Type.Optional(Type.String({ description: 'Optional model override as "provider/modelId". Omit to use the agent type\'s default.' })),
			thinking: Type.Optional(Type.String({ description: "Thinking level override, e.g. low/medium/high." })),
			max_turns: Type.Optional(Type.Number({ description: "Maximum agentic turns before a soft-limit steer, then a hard abort after a grace period. Omit for unlimited.", minimum: 1 })),
			run_in_background: Type.Optional(Type.Boolean({ description: "Run in the background and return an agent ID immediately. You'll be notified on completion — do not poll." })),
			isolated: Type.Optional(Type.Boolean({ description: "If true, the agent gets no extension/MCP tools, only built-ins." })),
			inherit_context: Type.Optional(Type.Boolean({ description: "If true, prepend a summary of the parent conversation. Default: false (fresh context)." })),
			isolation: Type.Optional(Type.Literal("worktree", { description: 'Set to "worktree" to run in a temporary git worktree. Changes are committed to a branch on completion.' })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			const p = params as {
				prompt: string;
				description: string;
				subagent_type?: string;
				resume?: string;
				model?: string;
				thinking?: string;
				max_turns?: number;
				run_in_background?: boolean;
				isolated?: boolean;
				inherit_context?: boolean;
				isolation?: IsolationMode;
			};

			if (p.resume) {
				const record = await manager.resume(p.resume, p.prompt, signal);
				if (!record) return toolResult(`No resumable agent found with id "${p.resume}".`);
				return toolResult(summarize(record), { agentId: record.id, status: record.status });
			}

			if (!p.subagent_type) return toolResult("subagent_type is required unless resume is set.");
			if (!resolveAgentConfig(p.subagent_type, ctx.cwd)) {
				return toolResult(`Unknown subagent_type "${p.subagent_type}". Run /agents to see available types.`);
			}

			const spawnOptions = {
				description: p.description,
				model: resolveModelString(ctx, p.model),
				maxTurns: p.max_turns,
				isolated: p.isolated,
				inheritContext: p.inherit_context,
				thinkingLevel: p.thinking as ThinkingLevel | undefined,
				isolation: p.isolation,
				signal,
			};

			if (p.run_in_background) {
				const id = manager.spawn(pi, ctx, p.subagent_type, p.prompt, { ...spawnOptions, isBackground: true });
				return toolResult(`Agent "${id}" spawned in the background. You'll be notified on completion.`, { agentId: id });
			}

			const { id, record } = await manager.spawnAndWait(pi, ctx, p.subagent_type, p.prompt, spawnOptions);
			return toolResult(summarize(record), { agentId: id, status: record.status });
		},
	});

	pi.registerTool({
		name: SUBAGENT_TOOL_NAMES.GET_RESULT,
		label: "Get Agent Result",
		description: "Check status and retrieve results from a background agent. Use the agent ID returned by Agent with run_in_background.",
		promptSnippet: "Check status and retrieve results from a background agent",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to check." }),
		}),
		async execute(_toolCallId, params) {
			const { agent_id } = params as { agent_id: string };
			const record = manager.getRecord(agent_id);
			if (!record) return toolResult(`No agent found with id "${agent_id}".`);
			record.resultConsumed = true;
			return toolResult(summarize(record), { agentId: agent_id, status: record.status });
		},
	});

	pi.registerTool({
		name: SUBAGENT_TOOL_NAMES.STEER,
		label: "Steer Agent",
		description:
			"Send a steering message to a running agent. The message interrupts the agent after its current tool execution " +
			"and is injected into its conversation. Only works on running or queued agents.",
		promptSnippet: "Send a steering message to redirect a running background agent",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to steer (must be currently running or queued)." }),
			message: Type.String({ description: "The steering message to inject." }),
		}),
		async execute(_toolCallId, params) {
			const { agent_id, message } = params as { agent_id: string; message: string };
			const ok = manager.steer(agent_id, message);
			return toolResult(ok ? `Steering message sent to agent "${agent_id}".` : `Agent "${agent_id}" is not running or queued — cannot steer.`);
		},
	});

	pi.registerCommand("agents", {
		description: "List running, queued, and recently completed subagents.",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const records = manager.listAgents();
			if (records.length === 0) {
				ctx.ui.notify?.("No subagents have run in this session.");
				return;
			}
			const lines = records.map((r) => `${r.status === "running" ? "●" : r.status === "queued" ? "◌" : "·"} ${summarize(r)}`);
			ctx.ui.notify?.(lines.join("\n\n"));
		},
	});
}
