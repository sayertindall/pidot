/**
 * pi-ssh extension registry.
 *
 * Pure wiring — imports the ssh extension factory and
 * registers it with the Pi ExtensionAPI.
 */
import sshToolsExtension from "./ssh/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piSshExtensions(pi: ExtensionAPI): void {
	sshToolsExtension(pi);
}
