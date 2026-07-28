/**
 * send-to-session.ts — send_to_session tool
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SocketState } from "../types";
import { getSocketPath, isSafeSessionId, isSocketAlive, writeMailboxMessage } from "../registry";
import { sendRpcCommand } from "../client";

export function registerSendToSessionTool(pi: ExtensionAPI, _state: SocketState): void {
	pi.registerTool({
		name: "send_to_session",
		label: "Send To Session",
		description: `Interact with another running pi session via its control socket.

Actions:
- send: Send a message (default). Requires 'message' parameter.
- get_message: Get the most recent assistant message.
- get_summary: Get an AI-generated summary of recent activity.
- get_result: Get the subagent result (if any).
- clear: Rewind session to initial state.
- abort: Abort the current turn.

Target selection:
- sessionId: UUID of the session (discover via list_sessions).
- sessionName: session alias (from /name).

Wait behavior (only for action=send):
- wait_until=turn_end: Wait for turn completion, returns last assistant message.
- wait_until=message_processed: Returns immediately after message is queued.
- wait_until=result_ready: Wait for subagent result contract.

Delivery modes:
- mode=steer: Deliver immediately (default).
- mode=follow_up: Queue for after current task.
- quiet=true: Deliver without triggering a turn. Model sees it next turn.

For scripts: PI_SESSION_ID env var contains the current session id.`,
		parameters: Type.Object({
			sessionId: Type.Optional(Type.String({ description: "Target session id (UUID)" })),
			sessionName: Type.Optional(Type.String({ description: "Target session name (alias)" })),
			action: Type.Optional(
				StringEnum(["send", "get_message", "get_summary", "get_result", "clear", "abort"], {
					description: "Action to perform (default: send)",
					default: "send",
				}),
			),
			message: Type.Optional(Type.String({ description: "Message to send (required for action=send)" })),
			mode: Type.Optional(
				StringEnum(["steer", "follow_up"], {
					description: "Delivery mode: steer (immediate) or follow_up (after task)",
					default: "steer",
				}),
			),
			quiet: Type.Optional(Type.Boolean({ description: "Deliver without triggering a turn", default: false })),
			wait_until: Type.Optional(
				StringEnum(["turn_end", "message_processed", "result_ready"], {
					description: "Wait behavior for send action",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const action = params.action ?? "send";
			const sessionName = params.sessionName?.trim();
			const sessionId = params.sessionId?.trim();
			let targetSessionId: string | null = null;
			const displayTarget = sessionName || sessionId || "";

			if (sessionName) {
				const { getLiveSessions } = await import("../registry");
				const sessions = await getLiveSessions();
				const match = sessions.find(
					(s) => s.aliases.includes(sessionName) || s.name === sessionName,
				);
				if (!match) {
					return {
						content: [{ type: "text" as const, text: `Unknown session name: ${sessionName}` }],
						isError: true,
					};
				}
				targetSessionId = match.sessionId;
			}

			if (sessionId) {
				if (!isSafeSessionId(sessionId)) {
					return {
						content: [{ type: "text" as const, text: "Invalid session id" }],
						isError: true,
					};
				}
				if (targetSessionId && targetSessionId !== sessionId) {
					return {
						content: [{ type: "text" as const, text: "Session name does not match session id" }],
						isError: true,
					};
				}
				targetSessionId = sessionId;
			}

			if (!targetSessionId) {
				return {
					content: [{ type: "text" as const, text: "Missing session id or session name" }],
					isError: true,
				};
			}

			const socketPath = getSocketPath(targetSessionId);

			try {
				if (action === "get_message") {
					return await execGetMessage(socketPath);
				}
				if (action === "get_summary") {
					return await execGetSummary(socketPath);
				}
				if (action === "get_result") {
					return await execGetResult(socketPath);
				}
				if (action === "clear") {
					return await execClear(socketPath);
				}
				if (action === "abort") {
					return await execAbort(socketPath);
				}

				// action === "send"
				if (!params.message || params.message.trim().length === 0) {
					return {
						content: [{ type: "text" as const, text: "Missing message for send action" }],
						isError: true,
					};
				}

				return await execSend(socketPath, targetSessionId, displayTarget, params);
			} catch (error) {
				const msg = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [{ type: "text" as const, text: `Failed: ${msg}` }],
					isError: true,
				};
			}
		},
	});
}

async function execSend(
	socketPath: string,
	sessionId: string,
	displayTarget: string,
	params: Record<string, unknown>,
): Promise<any> {
	const alive = await isSocketAlive(socketPath);

	if (!alive) {
		await writeMailboxMessage(sessionId, {
			type: "send",
			message: params.message as string,
			mode: (params.mode as "steer" | "follow_up") ?? "steer",
			quiet: (params.quiet as boolean) ?? false,
			metadata: {
				senderId: process.env.PI_SESSION_ID,
				kind: "user-message",
			},
		});

		return {
			content: [{ type: "text" as const, text: "Session offline — message queued for delivery on next start" }],
			details: { queued: true },
		};
	}

	const command: any = {
		type: "send",
		message: params.message as string,
		mode: (params.mode as string) ?? "steer",
		quiet: (params.quiet as boolean) ?? false,
		metadata: {
			senderId: process.env.PI_SESSION_ID,
			kind: "user-message",
		},
	};

	const waitUntil = params.wait_until as string | undefined;

	if (waitUntil === "message_processed") {
		const result = await sendRpcCommand(socketPath, command);
		if (!result.response.success) {
			return {
				content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
				isError: true,
			};
		}
		return {
			content: [{ type: "text" as const, text: "Message delivered" }],
		};
	}

	if (waitUntil === "turn_end") {
		const result = await sendRpcCommand(socketPath, command, {
			timeout: 300_000,
			waitForEvent: "turn_end",
		});
		if (!result.response.success) {
			return {
				content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
				isError: true,
			};
		}
		const lastMessage = (result.event as any)?.message;
		return {
			content: [{ type: "text" as const, text: lastMessage?.content ?? "Turn completed" }],
		};
	}

	if (waitUntil === "result_ready") {
		const result = await sendRpcCommand(socketPath, command, {
			timeout: 300_000,
			waitForEvent: "result_ready",
		});
		if (!result.response.success) {
			return {
				content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
				isError: true,
			};
		}
		return {
			content: [{ type: "text" as const, text: JSON.stringify((result.event as any)?.result ?? {}, null, 2) }],
		};
	}

	// No wait — fire-and-forget
	const result = await sendRpcCommand(socketPath, command);
	if (!result.response.success) {
		return {
			content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
			isError: true,
		};
	}

	return {
		content: [{ type: "text" as const, text: `Message sent to session ${displayTarget || sessionId}` }],
	};
}

async function execGetMessage(socketPath: string): Promise<any> {
	const result = await sendRpcCommand(socketPath, { type: "get_message" });
	if (!result.response.success) {
		return {
			content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
			isError: true,
		};
	}
	const data = result.response.data as { message?: { content: string } } | undefined;
	return {
		content: [{ type: "text" as const, text: data?.message?.content ?? "No assistant message found" }],
	};
}

async function execGetSummary(socketPath: string): Promise<any> {
	const result = await sendRpcCommand(socketPath, { type: "get_summary" }, { timeout: 60_000 });
	if (!result.response.success) {
		return {
			content: [{ type: "text" as const, text: `Failed: ${result.response.error ?? "unknown error"}` }],
			isError: true,
		};
	}
	const data = result.response.data as { summary?: string; model?: string } | undefined;
	return {
		content: [{ type: "text" as const, text: `Summary (via ${data?.model}):\n\n${data?.summary}` }],
	};
}

async function execGetResult(socketPath: string): Promise<any> {
	const result = await sendRpcCommand(socketPath, { type: "get_result" });
	const data = result.response.data as { result?: unknown } | undefined;
	return {
		content: [{ type: "text" as const, text: data?.result ? JSON.stringify(data.result, null, 2) : "No subagent result available" }],
	};
}

async function execClear(socketPath: string): Promise<any> {
	const result = await sendRpcCommand(socketPath, { type: "clear" });
	if (!result.response.success) {
		return {
			content: [{ type: "text" as const, text: `Failed to clear: ${result.response.error ?? "unknown error"}` }],
			isError: true,
		};
	}
	const data = result.response.data as { cleared?: boolean; alreadyAtRoot?: boolean } | undefined;
	return {
		content: [{ type: "text" as const, text: data?.alreadyAtRoot ? "Session already at root" : "Session cleared" }],
	};
}

async function execAbort(socketPath: string): Promise<any> {
	const result = await sendRpcCommand(socketPath, { type: "abort" });
	if (!result.response.success) {
		return {
			content: [{ type: "text" as const, text: `Failed to abort: ${result.response.error ?? "unknown error"}` }],
			isError: true,
		};
	}
	return {
		content: [{ type: "text" as const, text: "Abort sent" }],
	};
}
