/**
 * pi-toolkit-tilldone extension registry.
 */
import tilldoneExtension from "./tilldone/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitTilldoneExtensions(pi: ExtensionAPI): void {
	tilldoneExtension(pi);
}
