/**
 * context7/schemas.ts
 *
 * TypeBox schemas for the two LLM-callable tools. No `as` casts; pi
 * validates params against these at call time.
 */
import { Type } from "typebox";

export const SearchLibParams = Type.Object({
	libraryName: Type.String({
		description: "Library/package name to look up (e.g. 'react', 'next.js').",
		minLength: 1,
	}),
});

export const LookupLibParams = Type.Object({
	libraryId: Type.String({
		description: "Context7 library ID (returned by search_lib).",
		minLength: 1,
	}),
	query: Type.String({
		description: "What you need from the docs (e.g. 'server components', 'middleware setup').",
		minLength: 1,
	}),
	tokens: Type.Optional(
		Type.Number({
			description: "Max tokens of documentation to return (default 5000).",
			minimum: 100,
			maximum: 50000,
		}),
	),
});
