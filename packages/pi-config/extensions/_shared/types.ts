/**
 * Shared types for the pi-config package.
 */

/** Severity for a soft validation message. */
export type DiagnosticLevel = "warning" | "info";

/** Soft issue found while reading a config or state file. */
export interface Diagnostic {
	level: DiagnosticLevel;
	source: string;
	message: string;
}
