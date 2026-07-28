/**
 * _shared/run-record.ts
 *
 * Persistent state for the pi-process dispatchers. Writes one JSON
 * file per RunRecord under `~/.pi/agent/pi-process/<feature>/runs/`,
 * keyed by `record_id` + `launch_token` (the two-writer split per
 * PER-PACKAGE-SPECS-v3 §"Two RunRecord writers, one identity").
 *
 * Discipline (per PI-PROCESS-IMPL-SPEC.md §D5, §D8):
 *
 * - snake_case at rest, camelCase in memory.
 * - `withFileMutationQueue` for serialization.
 * - Temp-file + `renameSync` for atomic writes.
 * - On read failure (corrupt JSON, schema mismatch), move to
 *   `<path>.corrupt-<ISO-stamp>` and return null.
 * - TypeBox schema validation via `Value.Check(Schema, parsed)` from
 *   `typebox/value`. No `as` casts in production code.
 *
 * The `harness` field is `Type.Literal("interactive-shell")` for
 * records written by the pi-process package; future harnesses
 * (anything pi-subagents adds that needs crash-recoverable dispatch
 * state) write their own records with their own harness literal.
 */

import { Type } from "typebox";
import type { TerminalStatus } from "./terminal-status";

export const RunRecordHarness = Type.Literal("interactive-shell");

export const RunRecordAgent = Type.Union([
	Type.Literal("claude"),
	Type.Literal("codex"),
	Type.Literal("cursor"),
	Type.Literal("gemini"),
	Type.Literal("pi"),
]);

export const RunRecordStatus = Type.Union([
	Type.Literal("running"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("stopped"),
	Type.Literal("interrupted"),
]);

export const RunRecordDiskSchema = Type.Object({
	schema_version: Type.Literal(1),
	record_id: Type.String(),
	launch_token: Type.String(),
	harness: RunRecordHarness,
	agent: RunRecordAgent,
	task: Type.String(),
	cwd: Type.String(),
	worktree: Type.Optional(Type.Boolean()),
	supervision: Type.Union([
		Type.Literal("interactive"),
		Type.Literal("hands-free"),
		Type.Literal("dispatch"),
		Type.Literal("monitor"),
	]),
	status: RunRecordStatus,
	sentinel: Type.String(),
	created_at: Type.String(),
	updated_at: Type.String(),
});

export type RunRecordDisk = {
	schema_version: 1;
	record_id: string;
	launch_token: string;
	harness: "interactive-shell";
	agent: "claude" | "codex" | "cursor" | "gemini" | "pi";
	task: string;
	cwd: string;
	worktree?: boolean;
	supervision: "interactive" | "hands-free" | "dispatch" | "monitor";
	status: "running" | TerminalStatus;
	sentinel: string;
	created_at: string;
	updated_at: string;
};

export type RunRecord = Omit<RunRecordDisk, "created_at" | "updated_at"> & {
	createdAt: string;
	updatedAt: string;
};

export function runRecordPath(recordId: string, launchToken: string): string {
	// TODO: implement per PI-PROCESS-IMPL-SPEC.md §D2.
	// Stub: return a synthetic path; real impl joins the agent dir
	// with the snake_case filename.
	return `<stub>/${recordId}-${launchToken}.json`;
}

export function readRunRecord(
	recordId: string,
	launchToken: string,
): RunRecord | null {
	// TODO: implement per PI-PROCESS-IMPL-SPEC.md §D5.
	// Stub: always return null; real impl reads + validates + maps
	// snake_case → camelCase, moves corrupt files to .corrupt-<stamp>.
	void recordId;
	void launchToken;
	return null;
}

export async function mutateRunRecord(
	recordId: string,
	launchToken: string,
	transform: (current: RunRecord | null) => RunRecord,
): Promise<RunRecord> {
	// TODO: implement per PI-PROCESS-IMPL-SPEC.md §D5.
	// Stub: returns the transform's result without persistence; real
	// impl wraps withFileMutationQueue, writes atomically.
	void recordId;
	void launchToken;
	const current = readRunRecord(recordId, launchToken);
	return transform(current);
}

export function listRunRecords(): RunRecord[] {
	// TODO: implement per PI-PROCESS-IMPL-SPEC.md §D5.
	// Stub: returns empty; real impl reads the runs/ dir, validates
	// each file, skips corrupt.
	return [];
}
