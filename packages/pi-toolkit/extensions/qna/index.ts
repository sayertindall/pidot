/**
 * pi-toolkit-qna extension registry.
 */
import qnaExtension from "./qna/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piToolkitQnaExtensions(pi: ExtensionAPI): void {
	qnaExtension(pi);
}
