/**
 * client.ts — RPC client
 *
 * Connects to a control socket, sends a command, and collects the response.
 * Supports optional event subscription (turn_end, result_ready).
 */

import { createConnection } from "node:net";
import type { RpcCommand, RpcResponse, ExtractedMessage } from "./types";

export interface RpcClientOptions {
	timeout?: number;
	waitForEvent?: "turn_end" | "result_ready";
}

export interface RpcClientResult {
	response: RpcResponse;
	event?: {
		message?: ExtractedMessage;
		result?: unknown;
		turnIndex?: number;
	};
}

export function sendRpcCommand(
	socketPath: string,
	command: RpcCommand,
	options: RpcClientOptions = {},
): Promise<RpcClientResult> {
	const { timeout = 5000, waitForEvent } = options;

	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");

		const timeoutHandle = setTimeout(() => {
			socket.destroy(new Error("timeout"));
		}, timeout);

		let buffer = "";
		let response: RpcResponse | undefined;

		const cleanup = () => {
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
		};

		socket.on("connect", () => {
			socket.write(`${JSON.stringify(command)}\n`);

			if (waitForEvent) {
				const subCommand = {
					type: "subscribe" as const,
					event: waitForEvent,
					id: `cli_${Date.now()}`,
				};
				socket.write(`${JSON.stringify(subCommand)}\n`);
			}
		});

		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
				if (!line) continue;

				try {
					const msg = JSON.parse(line);

					if (msg.type === "response") {
						if (msg.command === command.type) {
							response = msg as RpcResponse;
							if (!waitForEvent) {
								cleanup();
								socket.end();
								resolve({ response });
								return;
							}
						}
						continue;
					}

					if (msg.type === "event" && msg.event === waitForEvent) {
						cleanup();
						socket.end();
						if (!response) {
							reject(new Error("Received event before response"));
							return;
						}
						resolve({ response, event: msg.data || {} });
						return;
					}
				} catch {
					// Ignore parse errors, keep waiting
				}
			}
		});

		socket.on("error", (error) => {
			cleanup();
			reject(error);
		});
	});
}
