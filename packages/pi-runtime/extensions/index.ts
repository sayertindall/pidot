/**
 * pi-runtime extension registry.
 *
 * Bundles all pi-runtime sub-extensions into one package:
 *   - goal           — Long-running main-agent goal with context-budget handoff
 *   - notrace        — No-trace mode for privacy-sensitive sessions
 *   - quit-and-delete — Quit pi and delete the current session
 *   - worktree       — Git worktree isolation for each session
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import goalExtensions from "./goal/index.js";
import notraceExtensions from "./notrace/index.js";
import quitAndDeleteExtensions from "./quit-and-delete/index.js";
import worktreeExtensions from "./worktree/index.js";

export default function piRuntimeExtensions(pi: ExtensionAPI): void {
	goalExtensions(pi);
	notraceExtensions(pi);
	quitAndDeleteExtensions(pi);
	worktreeExtensions(pi);
}
