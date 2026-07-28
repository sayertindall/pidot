/**
 * pi-herdr/schemas.ts
 *
 * TypeBox/pi-ai schemas for the three herdr tools. Uses
 * `StringEnum` from `@earendil-works/pi-ai` (the pi
 * equivalent of `Type.Union([...Type.Literal])` with
 * description support).
 */

import { StringEnum } from "@earendil-works/pi-ai";

export const StatusEnum = StringEnum(["idle", "working", "blocked", "done", "unknown"] as const, {
	description: "Agent lifecycle state",
});

export const ReadSourceEnum = StringEnum(["visible", "recent", "recent-unwrapped", "detection"] as const, {
	description: "Terminal snapshot source",
});

export const OutputFormatEnum = StringEnum(["text", "ansi"] as const, {
	description: "Output format; ansi preserves terminal styling",
});

export const DirectionEnum = StringEnum(["right", "down"] as const, {
	description: "Split direction. When omitted, the tool chooses from the source pane geometry.",
});

export const AgentKindEnum = StringEnum(
	[
		"pi",
		"claude",
		"codex",
		"gemini",
		"cursor",
		"devin",
		"agy",
		"cline",
		"omp",
		"mastracode",
		"opencode",
		"copilot",
		"kimi",
		"kiro",
		"droid",
		"amp",
		"grok",
		"hermes",
		"kilo",
		"qodercli",
		"maki",
	] as const,
	{ description: "Supported coding agent kind and canonical executable" },
);
