/**
 * server.ts — Unix socket server
 *
 * Creates and manages the per-session Unix domain socket. Handles:
 * - Socket lifecycle (create/bind/listen/close)
 * - Per-connection state (buffer, rate limit tracking)
 * - Inbound message parsing + dispatch to message-handler
 */

import { createServer, type Server, type Socket } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommand, writeResponse } from "./protocol";
import type { SocketState } from "./types";
import { handleCommand } from "./message-handler";
import { removeAliasesForSocket, removeSocket } from "./registry";

// ─── Connection State ─────────────────────────────────────────────

interface ConnectionState {
	buffer: string;
}

// ─── Server Management ────────────────────────────────────────────

export async function createControlServer(
	pi: ExtensionAPI,
	state: SocketState,
	socketPath: string,
): Promise<Server> {
	const server = createServer((socket: Socket) => {
		socket.setEncoding("utf8");
		const connState: ConnectionState = { buffer: "" };

		socket.on("data", (chunk: string) => {
			connState.buffer += chunk;
			let newlineIndex = connState.buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = connState.buffer.slice(0, newlineIndex).trim();
				connState.buffer = connState.buffer.slice(newlineIndex + 1);
				newlineIndex = connState.buffer.indexOf("\n");
				if (!line) continue;

				const parsed = parseCommand(line);
				if (parsed.error) {
					writeResponse(socket, {
						type: "response",
						command: "parse",
						success: false,
						error: `Failed to parse command: ${parsed.error}`,
					});
					continue;
				}

				handleCommand(pi, state, parsed.command!, socket);
			}
		});

		socket.on("error", () => {
			// Socket errors are expected on disconnect — silently ignore
		});
	});

	// Wait for server to start listening
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});

	return server;
}

export async function startControlServer(
	pi: ExtensionAPI,
	state: SocketState,
	sessionId: string,
): Promise<void> {
	const socketPath = getSessionSocketPath(sessionId);

	if (state.socketPath === socketPath && state.server) {
		return; // Already running on this socket
	}

	await stopControlServer(state);
	await removeSocket(socketPath);

	state.socketPath = socketPath;
	state.server = await createControlServer(pi, state, socketPath);
}

export async function stopControlServer(state: SocketState): Promise<void> {
	if (!state.server) {
		await removeAliasesForSocket(state.socketPath);
		await removeSocket(state.socketPath);
		state.socketPath = null;
		return;
	}

	const socketPath = state.socketPath;
	state.socketPath = null;
	state.turnEndSubscriptions = [];
	state.resultReadySubscriptions = [];

	await new Promise<void>((resolve) => state.server?.close(() => resolve()));
	state.server = null;
	await removeAliasesForSocket(socketPath);
	await removeSocket(socketPath);
}

// ─── Helpers ──────────────────────────────────────────────────────

import { getSocketPath as getSessionSocketPath } from "./registry";
