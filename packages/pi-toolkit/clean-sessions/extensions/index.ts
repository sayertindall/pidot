/**
 * pi-toolkit-clean-sessions extension registry.
 */
import cleanSessionsExtension from "./clean-sessions/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitCleanSessionsExtensions(pi: ExtensionAPI): void {
	cleanSessionsExtension(pi);
}
