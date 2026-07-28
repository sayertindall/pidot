/**
 * pi-toolkit-clean-sessions — scoring
 *
 * Auto-name detection and exemption logic. Sessions with a manually-chosen
 * short name (no date prefix) are always exempt from cleanup.
 */

import type { SessionCandidate } from "./types";

/** Matches session names that start with a date, e.g. "2026-01-15 ..." or "2026-01-15-foo". */
const AUTO_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/**
 * Returns true if the session name matches the auto-generated date-prefix
 * pattern used by Pi for unnamed sessions.
 */
export function isAutoNamePattern(name: string | null): boolean {
	if (name === null) return false;
	return AUTO_NAME_PATTERN.test(name);
}

/**
 * Returns true if this candidate should be exempt (preserved) from cleanup.
 *
 * A session is exempt when it has a non-null name AND that name does NOT
 * match the auto-name pattern — meaning it was deliberately named by the user.
 *
 * Auto-named (or unnamed) sessions are NOT exempt and are eligible for cleanup.
 */
export function shouldExempt(candidate: SessionCandidate): boolean {
	return candidate.name !== null && !isAutoNamePattern(candidate.name);
}
