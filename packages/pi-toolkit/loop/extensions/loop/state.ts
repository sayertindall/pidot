import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LOOP_STATE_ENTRY } from "./presets";
import type { LoopStateData } from "./types";

export async function loadState(ctx: ExtensionContext): Promise<LoopStateData> {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type: string; customType?: string; data?: LoopStateData };
		if (entry.type === "custom" && entry.customType === LOOP_STATE_ENTRY && entry.data) {
			return entry.data;
		}
	}
	return { active: false };
}

export function persistState(pi: ExtensionAPI, state: LoopStateData): void {
	pi.appendEntry(LOOP_STATE_ENTRY, state);
}
