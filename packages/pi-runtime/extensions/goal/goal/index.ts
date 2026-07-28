import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clearController, getRuntimeState, reconstructState } from "./state";
import { latestAssistantError, maybeQueueNextStep, pauseAfterAgentError, registerTools } from "./tool";
import { registerCommand } from "./command";
import { updateTui } from "./widget";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
		reconstructState(ctx);
		updateTui(ctx);
	});

	pi.on("session_tree", async (_event: any, ctx: ExtensionContext) => {
		reconstructState(ctx);
		updateTui(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearController();
	});

	pi.on("agent_start", async () => {
		const state = getRuntimeState();
		if (!state) return;
		state.continuationInFlight = false;
	});

	pi.on("agent_settled", async (_event: any, ctx: ExtensionContext) => {
		const error = latestAssistantError(ctx);
		if (error) {
			pauseAfterAgentError(pi, ctx, error);
			return;
		}
		maybeQueueNextStep(pi, ctx);
	});

	registerCommand(pi);
	registerTools(pi);
}
