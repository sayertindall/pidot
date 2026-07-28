/**
 * pi-toolkit-tilldone — schemas
 *
 * TypeBox schemas for tool parameters and persisted state validation.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { TillDoneState } from "./types";

/** Valid tilldone tool actions. */
export const TillDoneAction = StringEnum([
	"add",
	"done",
	"next",
	"prev",
	"list",
	"clear",
	"update",
] as const);

/** TypeBox schema for the tilldone tool parameters. */
export const TillDoneParams = Type.Object({
	action: TillDoneAction,
	text: Type.Optional(
		Type.String({ description: "Task text (for add/update)" }),
	),
	texts: Type.Optional(
		Type.Array(Type.String(), {
			description: "Multiple task texts (for batch add)",
		}),
	),
	id: Type.Optional(
		Type.Number({ description: "Task ID (for done/next/prev/update)" }),
	),
	gate: Type.Optional(
		Type.String({
			description:
				"Shell command that must exit 0 before the task can be marked done",
		}),
	),
	status: Type.Optional(
		StringEnum(["idle", "inprogress", "done"] as const, {
			description: "New status for update action",
		}),
	),
});

/** TypeBox schema for persisted state (used for validation on read). */
export const TillDoneStateSchema = Type.Object({
	enabled: Type.Boolean(),
	tasks: Type.Array(
		Type.Object({
			id: Type.Number(),
			text: Type.String(),
			status: StringEnum(["idle", "inprogress", "done"] as const),
			gate: Type.Optional(Type.String()),
		}),
	),
	nextId: Type.Number(),
});

/** Default empty state. */
export function defaultState(): TillDoneState {
	return { enabled: false, tasks: [], nextId: 1 };
}
