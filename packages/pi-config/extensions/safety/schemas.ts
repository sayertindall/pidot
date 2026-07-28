/**
 * TypeBox schema for safety.json.
 *
 * Validated at load. The file has a fixed shape (not a record), so
 * validation is all-or-nothing; we throw on shape mismatch with a
 * clear source path.
 */

import { Type } from "typebox";

const BashPattern = Type.Object({
	pattern: Type.String({ minLength: 1 }),
	reason: Type.String({ minLength: 1 }),
});

export const SafetyConfigSchema = Type.Object({
	version: Type.Literal(1),
	bash: Type.Object({
		blockPatterns: Type.Array(BashPattern),
	}),
	paths: Type.Object({
		readOnly: Type.Array(Type.String()),
		noDelete: Type.Array(Type.String()),
	}),
	credentials: Type.Object({
		blockPatterns: Type.Array(Type.String()),
		blockFiles: Type.Array(Type.String()),
	}),
});
