/**
 * shell/index.ts
 *
 * Extension factory. Registers the `interactive_shell` tool, /spawn /attach
 * /dismiss, the widget, and session_shutdown cleanup. Wiring only -- all
 * branching logic lives in commands.ts (the tool handler) and state.ts
 * (startup reconcile).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import {
	createShellRuntime,
	handleAttachCommand,
	handleDismissCommand,
	handleSpawnCommand,
	handleToolExecute,
} from "./commands";
import { loadConfig } from "./config";
import { TOOL_DESCRIPTION, TOOL_LABEL, TOOL_NAME, toolParameters } from "./schemas";
import { scanRuns } from "./state";
import { setupBackgroundWidget } from "./widget";

export default function shellExtension(pi: ExtensionAPI): void {
	scanRuns();

	const startupConfig = loadConfig(process.cwd());
	const runtime = createShellRuntime(pi);

	pi.registerShortcut(startupConfig.focusShortcut as KeyId, {
		description: "Focus the pi-dispatch overlay",
		handler: () => {
			runtime.coordinator.focusOverlay();
		},
	});

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		runtime.coordinator.replaceBackgroundWidgetCleanup(setupBackgroundWidget(ctx, runtime.registry, runtime.coordinator));
	});

	pi.on("session_shutdown", async () => {
		runtime.coordinator.clearBackgroundWidget();
		runtime.shutdown();
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description: TOOL_DESCRIPTION,
		promptSnippet: "Run an interactive CLI coding agent (Claude Code, Codex, Gemini, Cursor) in a real PTY overlay",
		parameters: toolParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return handleToolExecute(runtime, pi, params, ctx);
		},
	});

	pi.registerCommand("spawn", {
		description: "Spawn a coding agent: /spawn [pi|codex|claude|cursor|gemini] [fresh|fork] [--worktree] [--hands-free|--dispatch \"prompt\"]",
		handler: async (args, ctx) => {
			await handleSpawnCommand(runtime, pi, args, ctx);
		},
	});

	pi.registerCommand("attach", {
		description: "Reattach to a background pi-dispatch session: /attach [sessionId]",
		getArgumentCompletions: (prefix) => {
			const ids = runtime.registry.list().map((s) => s.sessionId).filter((id) => id.startsWith(prefix));
			return ids.length > 0 ? ids.map((id) => ({ value: id, label: id })) : null;
		},
		handler: async (args, ctx) => {
			await handleAttachCommand(runtime, pi, args, ctx);
		},
	});

	pi.registerCommand("dismiss", {
		description: "Dismiss background pi-dispatch sessions: /dismiss [sessionId]",
		getArgumentCompletions: (prefix) => {
			const ids = runtime.registry.list().map((s) => s.sessionId).filter((id) => id.startsWith(prefix));
			return ids.length > 0 ? ids.map((id) => ({ value: id, label: id })) : null;
		},
		handler: async (args, ctx) => {
			await handleDismissCommand(runtime, pi, args, ctx);
		},
	});
}
