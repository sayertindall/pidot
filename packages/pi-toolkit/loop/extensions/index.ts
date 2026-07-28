/**
 * pi-toolkit-loop extension registry.
 */
import loopExtension from "./loop/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitLoopExtensions(pi: ExtensionAPI): void {
	loopExtension(pi);
}
