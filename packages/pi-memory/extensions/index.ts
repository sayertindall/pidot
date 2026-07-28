/**
 * pi-memory extension registry.
 */
import memoryExtension from "./memory/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piMemoryExtensions(pi: ExtensionAPI): void {
	memoryExtension(pi);
}
