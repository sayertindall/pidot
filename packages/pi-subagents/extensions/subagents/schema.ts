/**
 * schema.ts
 *
 * TypeBox schemas. AgentFrontmatterSchema documents the defaults discovery.ts's
 * field-by-field parser already applies (SUB-SPEC-v4.md §2.2 -- the reference's
 * parser has no silent-drop bug to fix, this is documentation of its contract,
 * not a new validation gate). The on-disk ScheduleStore schemas are snake_case
 * per this spec family's durability rule; state.ts owns translation to/from
 * the camelCase ScheduledSubagent in types.ts.
 */
import { Type } from "typebox";

export const AgentFrontmatterSchema = Type.Object({
	name: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
	display_name: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	tools: Type.Optional(Type.String()),
	disallowed_tools: Type.Optional(Type.String()),
	extensions: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
	exclude_extensions: Type.Optional(Type.String()),
	skills: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(
		Type.Union(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((v) => Type.Literal(v))),
	),
	max_turns: Type.Optional(Type.Integer({ minimum: 0 })),
	persist_session: Type.Optional(Type.Boolean()),
	session_dir: Type.Optional(Type.String()),
	prompt_mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("append")])),
	inherit_context: Type.Optional(Type.Boolean()),
	run_in_background: Type.Optional(Type.Boolean()),
	isolated: Type.Optional(Type.Boolean()),
	memory: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("local")])),
	isolation: Type.Optional(Type.Literal("worktree")),
	enabled: Type.Optional(Type.Boolean()),
});

/** On-disk (snake_case) shape of one scheduled subagent job. See SUB-SPEC-v4.md §3.1. */
export const ScheduledSubagentDiskSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	description: Type.String(),
	schedule: Type.String(),
	schedule_type: Type.Union([Type.Literal("cron"), Type.Literal("once"), Type.Literal("interval")]),
	interval_ms: Type.Optional(Type.Integer({ minimum: 0 })),

	subagent_type: Type.String(),
	prompt: Type.String(),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(
		Type.Union(["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((v) => Type.Literal(v))),
	),
	max_turns: Type.Optional(Type.Integer({ minimum: 0 })),
	isolated: Type.Optional(Type.Boolean()),
	isolation: Type.Optional(Type.Literal("worktree")),

	enabled: Type.Boolean(),
	created_at: Type.String(),
	last_run: Type.Optional(Type.String()),
	last_status: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("error"), Type.Literal("running")])),
	next_run: Type.Optional(Type.String()),
	run_count: Type.Integer({ minimum: 0 }),
});

export const ScheduleStoreDiskSchema = Type.Object({
	version: Type.Literal(1),
	jobs: Type.Array(ScheduledSubagentDiskSchema),
});
