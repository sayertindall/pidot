/**
 * Two validation modes, kept distinct on purpose.
 *
 * - `validateConfigOrThrow` is for files whose shape is a hard contract:
 *   presets.json, safety.json, settings.json. If they're wrong, the
 *   extension refuses to load and surfaces the error. Better to fail loud
 *   than to silently fall back to defaults.
 *
 * - `validateConfigWithDiagnostics` is for files where partial validity
 *   is useful: agent role files, user-supplied safety rule packs. The
 *   loader keeps what it can, drops what it can't, and returns a list of
 *   warnings the UI can surface via `notify`.
 *
 * Both helpers use typebox/value.Check and typebox/value.Errors so the
 * TypeBox schema object can be passed directly without us caring about
 * which TypeBox version is installed.
 */

import { Value } from "typebox/value";
import type { Diagnostic } from "./types";

/** A TypeBox schema — anything `Value.Check` will accept. */
export type TypeBoxSchema = object | boolean;

function formatErrors(schema: TypeBoxSchema, value: unknown): string {
	try {
		const errors = [...Value.Errors(schema, value)];
		if (errors.length === 0) return "(no error details)";
		return errors
			.map((e) => {
				const path = "path" in e && typeof e.path === "string" ? e.path : "/";
				const msg = "message" in e && typeof e.message === "string" ? e.message : String(e);
				return `${path}: ${msg}`;
			})
			.join("; ");
	} catch {
		return "(could not compute errors)";
	}
}

/**
 * Validate `value` against a TypeBox schema. Throws on shape mismatch,
 * prefixed with the source label. Use this for hard contracts.
 */
export function validateConfigOrThrow<T>(value: unknown, schema: TypeBoxSchema, source: string): T {
	if (Value.Check(schema, value)) return value as T;
	throw new Error(`Invalid ${source}: ${formatErrors(schema, value)}`);
}

/**
 * Same as `validateConfigOrThrow` but returns a `{ value, diagnostics }`
 * pair. If the value is invalid, returns `undefined` for `value` and a
 * single warning diagnostic. The caller decides whether to abort or to
 * proceed with a partial result.
 */
export function validateConfigWithDiagnostics<T>(
	value: unknown,
	schema: TypeBoxSchema,
	source: string,
): { value: T | undefined; diagnostics: Diagnostic[] } {
	if (Value.Check(schema, value)) return { value: value as T, diagnostics: [] };
	return {
		value: undefined,
		diagnostics: [{ level: "warning", source, message: `Shape mismatch: ${formatErrors(schema, value)}` }],
	};
}

/**
 * Validate a record of named items, dropping the ones that fail and
 * collecting per-key warnings. Useful for presets.json (record of
 * named presets) and agent .md files (record of named roles).
 */
export function validateRecordEntries<T>(
	raw: unknown,
	schema: TypeBoxSchema,
	sourceFor: (key: string) => string,
): { entries: Record<string, T>; diagnostics: Diagnostic[] } {
	const diagnostics: Diagnostic[] = [];
	const entries: Record<string, T> = {};
	if (typeof raw !== "object" || raw === null) {
		diagnostics.push({ level: "warning", source: sourceFor("<root>"), message: "Expected an object" });
		return { entries, diagnostics };
	}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (Value.Check(schema, value)) {
			entries[key] = value as T;
		} else {
			diagnostics.push({
				level: "warning",
				source: sourceFor(key),
				message: formatErrors(schema, value),
			});
		}
	}
	return { entries, diagnostics };
}
