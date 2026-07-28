/**
 * pi-toolkit-find-session — schemas
 *
 * TypeBox schemas for the (future) find-session tool. The current
 * extension only registers a slash command; this stub exists so the
 * import boundary is in place when the tool is wired in.
 *
 * The agent does not call this tool today.
 */

import { Type } from "typebox";

export const FindSessionToolParams = Type.Object({
	query: Type.String({
		description: "Literal text to search for across past Pi sessions (case-insensitive).",
	}),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 50,
			default: 10,
			description: "Maximum number of session matches to return. Defaults to 10.",
		}),
	),
});
