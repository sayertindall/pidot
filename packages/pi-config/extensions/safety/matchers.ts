/**
 * Safety matchers: glob, safe regex, bash check, write/edit check.
 *
 * Pure functions over config + inputs. No I/O, no extension API.
 * Trivially unit-testable.
 */

import { basename } from "node:path";
import type { SafetyConfig } from "./types";

/**
 * Match a glob pattern against a filesystem path.
 *
 *   "dist/"   directory prefix — matches dist/ or any/.../dist/...
 *   "*.lock"  wildcard glob — regex match on basename or full path
 *   "LICENSE" exact name — basename match
 */
export function matchGlob(pattern: string, path: string): boolean {
	const normalized = path.replace(/\\/g, "/");

	if (pattern.endsWith("/")) {
		const dir = pattern.slice(0, -1);
		return normalized === dir || normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`);
	}

	if (pattern.includes("*")) {
		const regex = globToRegex(pattern);
		return regex.test(normalized) || regex.test(basename(normalized));
	}

	return basename(normalized) === pattern;
}

function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`(^|/)${escaped}$`);
}

/** Commands or flags that delete files. */
const DELETE_RE = /\b(rm|rmdir|unlink|shred|trash|srm)\b|-delete|--delete\b/;

/** Compile a pattern as a regex. Falls back to literal substring match if invalid. */
export function safeRegex(pattern: string): RegExp | undefined {
	try {
		return new RegExp(pattern);
	} catch {
		try {
			return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		} catch {
			return undefined;
		}
	}
}

/** Check a bash command. Returns a reason string when blocked. */
export function checkBash(command: string, cfg: SafetyConfig): string | undefined {
	for (const { pattern, reason } of cfg.bash.blockPatterns) {
		if (command.toLowerCase().includes(pattern.toLowerCase())) {
			return `${reason}: "${pattern}"`;
		}
	}

	if (cfg.paths.noDelete.length > 0 && DELETE_RE.test(command)) {
		for (const protectedPath of cfg.paths.noDelete) {
			const needle = protectedPath.replace(/\/$/, "");
			if (command.includes(needle)) {
				return `Deletion of protected path: "${protectedPath}"`;
			}
		}
	}

	return undefined;
}

/** Check a write/edit. Returns a reason string when blocked. */
export function checkWriteOrEdit(path: string, content: string | undefined, cfg: SafetyConfig): string | undefined {
	for (const pattern of cfg.paths.readOnly) {
		if (matchGlob(pattern, path)) {
			return `Read-only path protected: "${path}"`;
		}
	}

	for (const pattern of cfg.credentials.blockFiles) {
		if (matchGlob(pattern, path)) {
			return `Credential file protected: "${path}"`;
		}
	}

	if (content) {
		for (const pattern of cfg.credentials.blockPatterns) {
			const regex = safeRegex(pattern);
			if (regex && regex.test(content)) {
				return `Credential pattern detected in content: "${pattern}"`;
			}
		}
	}

	return undefined;
}
