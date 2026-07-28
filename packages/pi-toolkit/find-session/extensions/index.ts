/**
 * pi-toolkit-find-session extension registry.
 */
import findSessionExtension from "./find-session/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitFindSessionExtensions(pi: ExtensionAPI): void {
	findSessionExtension(pi);
}
