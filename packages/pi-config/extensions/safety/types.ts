/**
 * Safety types.
 *
 * The on-disk shape (safety.json) uses snake_case keys. In-memory
 * (after load) keeps snake_case too — the file is a fixed shape, not
 * a record of named things, so there's no ergonomic reason to rename.
 */

/** A single bash block pattern: a substring to match + a reason to surface. */
export interface BashBlockPattern {
	pattern: string;
	reason: string;
}

/** Top-level safety config. */
export interface SafetyConfig {
	version: number;
	bash: {
		blockPatterns: BashBlockPattern[];
	};
	paths: {
		readOnly: string[];
		noDelete: string[];
	};
	credentials: {
		blockPatterns: string[];
		blockFiles: string[];
	};
}

/** Empty default. Used when no safety.json exists or parsing fails. */
export const EMPTY_SAFETY_CONFIG: SafetyConfig = {
	version: 1,
	bash: { blockPatterns: [] },
	paths: { readOnly: [], noDelete: [] },
	credentials: { blockPatterns: [], blockFiles: [] },
};
