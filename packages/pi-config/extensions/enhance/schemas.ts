/**
 * enhance/schemas.ts
 *
 * TypeBox schema for the LLM-callable tool `enhance_prompt`. Also
 * includes the `EnhanceStateSchema` used to validate persisted state.
 */
import { Type } from "typebox";

export const EnhanceStateSchema = Type.Object({
	activeName: Type.Optional(Type.String()),
});

export const EnhancePromptParams = Type.Object({
	text: Type.String({
		description: "The prompt text to rewrite.",
		minLength: 1,
	}),
	preset: Type.Optional(
		Type.String({
			description: "Optional preset name to override the active preset for this call.",
		}),
	),
});
