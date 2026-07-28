/**
 * Path helpers for the pi-config package.
 *
 * All persistent state lives under `~/.pi/agent/pi-config/`. The
 * `getAgentDir()` function from @earendil-works/pi-coding-agent returns
 * the base agent directory; we append a per-package subdirectory and
 * optionally a per-session subdirectory underneath that.
 *
 * Cross-session state sits at `<feature>/<file>.json` (e.g. preset config).
 * Session-tied state sits at `<feature>/<encoded-session-id>/<file>.json`.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

/** Package-level config directory (cross-session). */
export function getPackageDir(): string {
	return join(getAgentDir(), "pi-config");
}

/** Per-feature directory inside the package. */
export function getFeatureDir(feature: string): string {
	return join(getPackageDir(), feature);
}

/** Per-session subdirectory under a feature. `sessionId` is base64url-encoded by the caller. */
export function getSessionFeatureDir(feature: string, encodedSessionId: string): string {
	return join(getFeatureDir(feature), encodedSessionId);
}

/** Path to a state file inside a feature directory. */
export function getFeatureStatePath(feature: string, filename: string): string {
	return join(getFeatureDir(feature), filename);
}
