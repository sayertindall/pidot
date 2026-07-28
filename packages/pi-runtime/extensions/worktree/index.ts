/**
 * pi-runtime-worktree extension registry.
 */
import worktreeExtension from "./worktree/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRuntimeWorktreeExtensions(pi: ExtensionAPI): void {
	worktreeExtension(pi);
}
