/**
 * review/schemas.ts
 *
 * TypeBox schemas for the LLM-callable `start_review` tool (if/when we
 * register one — currently we use slash commands only) and for the
 * persisted state file.
 */
import { Type } from "typebox";

export const ReviewStateSchema = Type.Object({
	current: Type.Union([
		Type.Null(),
		Type.Object({
			target: Type.Object({
				type: Type.Union([
					Type.Literal("uncommitted"),
					Type.Literal("baseBranch"),
					Type.Literal("commit"),
					Type.Literal("pullRequest"),
				]),
				branch: Type.Optional(Type.String()),
				sha: Type.Optional(Type.String()),
				title: Type.Optional(Type.String()),
				prNumber: Type.Optional(Type.Number()),
				baseBranch: Type.Optional(Type.String()),
			}),
			status: Type.Union([
				Type.Literal("idle"),
				Type.Literal("launching"),
				Type.Literal("running"),
				Type.Literal("done"),
				Type.Literal("failed"),
				Type.Literal("cancelled"),
			]),
			startedAt: Type.Number(),
			updatedAt: Type.Number(),
			finishedAt: Type.Optional(Type.Number()),
			lastActivityAt: Type.Optional(Type.Number()),
			lastToolName: Type.Optional(Type.String()),
			toolCount: Type.Number(),
			filesChanged: Type.Optional(Type.Number()),
			result: Type.Optional(Type.String()),
			error: Type.Optional(Type.String()),
		}),
	]),
});
