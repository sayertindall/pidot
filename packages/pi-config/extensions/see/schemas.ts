/**
* see/schemas.ts
*
* TypeBox schema for the LLM-callable tool `see`.
*/
import { Type } from "typebox";

export const SeeParams = Type.Object({
	paths: Type.Array(
		Type.String({
			description:
				"Absolute path(s) to the image file(s) to look at (png, jpg, jpeg, gif, webp, bmp).",
		}),
		{ minItems: 1 },
	),
	prompt: Type.Optional(
		Type.String({
			description:
				"What to look for. Defaults to a detailed visual description. Ask for specifics " +
				"(exact text, colors, layout, UI states, error messages) when you need them.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description:
				"Codex model id to use for vision. Defaults to gpt-5.6-luna.",
		}),
	),
});
