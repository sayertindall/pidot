/**
 * pi-runtime-notrace extension registry.
 */
import notraceExtension from "./notrace/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRuntimeNotraceExtensions(pi: ExtensionAPI): void {
	notraceExtension(pi);
}
