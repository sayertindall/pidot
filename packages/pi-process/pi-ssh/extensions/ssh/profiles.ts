/**
 * pi-ssh/profiles.ts
 *
 * Profile parsing from `~/.ssh/config` and target-arg
 * normalization for the `/ssh <host>[:/path]` command.
 *
 * Pure functions — no I/O at module load. The parse function
 * takes an explicit config-path argument so tests can use a
 * fixture file in `mkdtempSync` rather than touching the real
 * user's config.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SshProfile } from "./types";

/**
 * Default location of the user's SSH config.
 */
export function defaultSshConfigPath(home: string): string {
	return join(home, ".ssh", "config");
}

/**
 * Parse `~/.ssh/config`-style text into a deduplicated list of
 * profile records. Wildcard hosts (`*`, `?`, `!` prefixed) are
 * skipped — they're not usable as direct targets.
 */
export function parseSshConfig(text: string): SshProfile[] {
	const profiles = new Map<string, SshProfile>();

	for (const rawLine of text.split("\n")) {
		const withoutComment = rawLine.replace(/\s+#.*$/, "").trim();
		if (!withoutComment) continue;

		const match = withoutComment.match(/^Host\s+(.+)$/i);
		if (!match) continue;

		const aliases = (match[1] ?? "")
			.split(/\s+/)
			.map((alias) => alias.trim())
			.filter(Boolean)
			.filter((alias) => !alias.includes("*") && !alias.includes("?") && !alias.startsWith("!"));

		for (const alias of aliases) {
			if (!profiles.has(alias)) {
				profiles.set(alias, { name: alias, remote: alias });
			}
		}
	}

	return Array.from(profiles.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read profiles from a config file path. Returns an empty array
 * if the file doesn't exist.
 */
export function readSshProfiles(configPath: string): SshProfile[] {
	if (!existsSync(configPath)) return [];
	return parseSshConfig(readFileSync(configPath, "utf8"));
}

/**
 * Normalize a `/ssh <arg>` argument into an SshProfile:
 * - exact match against a known profile: return that profile
 * - `host:/path` form: split into remote + cwd
 * - bare `host`: profile with that name + remote
 */
export function normalizeTargetArg(arg: string, profiles: readonly SshProfile[]): SshProfile {
	const trimmed = arg.trim();
	const matchedProfile = profiles.find((profile) => profile.name === trimmed);
	if (matchedProfile) {
		return matchedProfile;
	}

	const separatorIndex = trimmed.indexOf(":");
	if (separatorIndex > 0) {
		return {
			name: trimmed,
			remote: trimmed.slice(0, separatorIndex),
			cwd: trimmed.slice(separatorIndex + 1),
		};
	}

	return { name: trimmed, remote: trimmed };
}
