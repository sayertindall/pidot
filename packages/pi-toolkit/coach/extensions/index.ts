/**
 * pi-toolkit-coach extension registry.
 */
import coachExtension from "./coach/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitCoachExtensions(pi: ExtensionAPI): void {
	coachExtension(pi);
}
