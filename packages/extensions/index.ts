/**
 * pi-extensions — unified extension registry.
 *
 * One entry point for all extensions. Installed via:
 *   "git:github.com/echohub-ai/pi-extensions@main"
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piConfigExtensions from "../pi-config/extensions/index.js";
import piMemoryExtensions from "../pi-memory/extensions/index.js";
import piProcessExtensions from "../pi-process/extensions/index.js";
import piRuntimeExtensions from "../pi-runtime/extensions/index.js";
import piSubagentsExtensions from "../pi-subagents/extensions/index.js";
import piToolkitExtensions from "../pi-toolkit/extensions/index.js";
import piWebtoolsExtensions from "../pi-webtools/extensions/index.js";
import piZentuiExtensions from "../pi-zentui/extensions/index.js";

export default function piExtensions(pi: ExtensionAPI): void {
	piConfigExtensions(pi);
	piMemoryExtensions(pi);
	piProcessExtensions(pi);
	piRuntimeExtensions(pi);
	piSubagentsExtensions(pi);
	piToolkitExtensions(pi);
	piWebtoolsExtensions(pi);
	piZentuiExtensions(pi);
}
