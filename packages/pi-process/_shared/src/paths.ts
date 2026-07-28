/**
 * _shared/paths.ts
 *
 * `~/.pi/agent/pi-process/*` layout. Every extension in
 * packages/pi-process/ owns a subdirectory here for its state
 * files. The base is `getAgentDir() + "/pi-process"`; each
 * extension's directory is `<base>/<extension>/`.
 *
 * Honors the v3 "no root pollution" rule (PER-PACKAGE-SPECS-v3
 * §"Data location"): no `data/` subdirectory at the agent root,
 * the package dir *is* the data dir.
 */

import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PI_PROCESS_BASE = join(getAgentDir(), "pi-process");

/**
 * Returns `~/.pi/agent/pi-process/<extension>/`. Extension authors
 * join their file names onto this path.
 */
export function extensionDir(extension: "pi-tmux" | "pi-ssh" | "pi-shell" | "pi-herdr"): string {
	return join(PI_PROCESS_BASE, extension);
}
