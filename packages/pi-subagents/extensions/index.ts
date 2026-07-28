/**
 * pi-subagents extension registry.
 */
import subagentsExtensions from "./subagents/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piSubagentsExtensions(pi: ExtensionAPI): void {
	subagentsExtensions(pi);
}
