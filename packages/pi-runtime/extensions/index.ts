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
import goalExtensions from "../goal/extensions/index";
import notraceExtensions from "../notrace/extensions/index";
import quitAndDeleteExtensions from "../quit-and-delete/extensions/index";
import worktreeExtensions from "../worktree/extensions/index";

export default function piRuntimeExtensions(pi: ExtensionAPI): void {
	goalExtensions(pi);
	notraceExtensions(pi);
	quitAndDeleteExtensions(pi);
	worktreeExtensions(pi);
}
