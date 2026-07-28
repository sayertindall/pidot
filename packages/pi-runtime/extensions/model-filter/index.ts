/**
 * pi-runtime-model-filter extension registry.
 */
import modelFilterExtension from "./model-filter/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRuntimeModelFilterExtensions(pi: ExtensionAPI): void {
	modelFilterExtension(pi);
}
