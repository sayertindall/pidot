/**
 * protocol.ts — JSON-RPC wire format
 *
 * Newline-delimited JSON. Each line is a complete message.
 * - parseCommand: validate and parse inbound JSON
 * - writeResponse: serialize and write a response to a socket
 * - writeEvent: serialize and write an async event to a socket
 */

import type { Socket } from "node:net";
import type { RpcCommand, RpcResponse, RpcEvent } from "./types";

export function parseCommand(line: string): { command?: RpcCommand; error?: string } {
	try {
		const parsed = JSON.parse(line) as RpcCommand;
		if (!parsed || typeof parsed !== "object") {
			return { error: "Invalid command" };
		}
		if (typeof parsed.type !== "string") {
			return { error: "Missing command type" };
		}
		return { command: parsed };
	} catch (error) {
		return { error: error instanceof Error ? error.message : "Failed to parse command" };
	}
}

export function writeResponse(socket: Socket, response: RpcResponse): void {
	try {
		socket.write(`${JSON.stringify(response)}\n`);
	} catch {
		// Socket may be closed
	}
}

export function writeEvent(socket: Socket, event: RpcEvent): void {
	try {
		socket.write(`${JSON.stringify(event)}\n`);
	} catch {
		// Socket may be closed
	}
}
