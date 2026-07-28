/**
 * pi-runtime-goal extension registry.
 */
import goalExtension from "./goal/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRuntimeGoalExtensions(pi: ExtensionAPI): void {
	goalExtension(pi);
}
