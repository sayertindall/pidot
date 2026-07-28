/**
 * pi-toolkit-qna — schemas
 *
 * TypeBox schemas for the (future) qna tool. The current extension
 * only registers a slash command. This stub exists so the import
 * boundary is in place when the tool is wired in.
 *
 * The agent does not call this tool today.
 */

import { Type } from "typebox";

export const QnAAnswer = Type.Object({
	question: Type.String({ description: "The question that was extracted" }),
	context: Type.Optional(Type.String({ description: "Optional context that accompanied the question" })),
	answer: Type.String({ description: "The user's answer to the question" }),
});

export const QnAExtractionParams = Type.Object({
	text: Type.Optional(
		Type.String({
			description: "Source text to extract questions from. Defaults to the last assistant message.",
		}),
	),
});
