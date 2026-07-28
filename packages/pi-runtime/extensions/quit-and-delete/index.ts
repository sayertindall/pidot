/**
 * pi-runtime-quit-and-delete extension registry.
 */
import quitAndDeleteExtension from "./quit-and-delete/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piRuntimeQuitAndDeleteExtensions(pi: ExtensionAPI): void {
	quitAndDeleteExtension(pi);
}
