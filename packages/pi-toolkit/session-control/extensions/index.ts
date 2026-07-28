/**
 * pi-toolkit-session-control extension registry.
 */
import sessionControlExtension from "./session-control/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitSessionControlExtensions(pi: ExtensionAPI): void {
	sessionControlExtension(pi);
}
