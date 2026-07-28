/**
 * Tool-call hook: blocks dangerous operations.
 *
 * Stateless: reads from the cached config that the entry point
 * populated at `session_start`. No disk I/O here.
 */

import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { checkBash, checkWriteOrEdit } from "./matchers";
import type { SafetyConfig } from "./types";

export function bindToolCallHook(pi: ExtensionAPI, getConfig: () => SafetyConfig): void {
	pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | void> => {
		const cfg = getConfig();
		let reason: string | undefined;

		if (isToolCallEventType("bash", event)) {
			reason = checkBash(event.input.command, cfg);
		} else if (isToolCallEventType("write", event)) {
			reason = checkWriteOrEdit(event.input.path, event.input.content, cfg);
		} else if (isToolCallEventType("edit", event)) {
			const content = event.input.edits.map((e) => e.newText).join("\n");
			reason = checkWriteOrEdit(event.input.path, content, cfg);
		}

		if (!reason) return undefined;
		if (ctx.hasUI) ctx.ui.notify(`Safety: ${reason}`, "warning");
		return { block: true, reason };
	});
}
