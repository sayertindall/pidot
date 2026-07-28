/**
 * registry.ts — Socket directory management
 *
 * The socket directory IS the session registry. No broker, no polling.
 * - isSocketAlive(): cheap connect() probe (300ms timeout)
 * - getLiveSessions(): scan directory, filter alive, return sorted list
 * - Alias symlink management: create/read/delete
 * - Session tags: read/write <id>.tags JSON
 * - Mailbox: read/write <id>.mailbox JSONL
 */

import { promises as fs, existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { LiveSessionInfo, MailboxMessage, RpcSendCommand, SessionTags } from "./types";

const CONTROL_DIR = join(getAgentDir(), "pi-toolkit", "session-control");
const SOCKET_SUFFIX = ".sock";
const ALIAS_SUFFIX = ".alias";
const TAGS_SUFFIX = ".tags";
const MAILBOX_SUFFIX = ".mailbox";
const DEAD_SUFFIX = ".dead";

// ─── Path Helpers ─────────────────────────────────────────────────

export function getSocketPath(sessionId: string): string {
	return join(CONTROL_DIR, `${sessionId}${SOCKET_SUFFIX}`);
}

function getAliasPath(alias: string): string {
	return join(CONTROL_DIR, `${alias}${ALIAS_SUFFIX}`);
}

function getTagsPath(sessionId: string): string {
	return join(CONTROL_DIR, `${sessionId}${TAGS_SUFFIX}`);
}

function getMailboxPath(sessionId: string): string {
	return join(CONTROL_DIR, `${sessionId}${MAILBOX_SUFFIX}`);
}

// ─── Safety ───────────────────────────────────────────────────────

export function isSafeSessionId(id: string): boolean {
	return !id.includes("/") && !id.includes("\\") && !id.includes("..") && id.length > 0;
}

export function isSafeAlias(alias: string): boolean {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(alias);
}

// ─── Directory Management ─────────────────────────────────────────

export async function ensureControlDir(): Promise<void> {
	await fs.mkdir(CONTROL_DIR, { recursive: true, mode: 0o700 });
}

export function getControlDir(): string {
	return CONTROL_DIR;
}

// ─── Socket Lifecycle ─────────────────────────────────────────────

export async function removeSocket(socketPath: string | null): Promise<void> {
	if (!socketPath) return;
	try {
		await fs.unlink(socketPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "ENOENT") throw error;
	}
}

export async function isSocketAlive(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(socketPath);
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 300);

		const cleanup = (alive: boolean) => {
			clearTimeout(timeout);
			socket.removeAllListeners();
			resolve(alive);
		};

		socket.once("connect", () => {
			socket.end();
			cleanup(true);
		});
		socket.once("error", () => {
			cleanup(false);
		});
	});
}

// ─── Alias Management ─────────────────────────────────────────────

export async function createAliasSymlink(sessionId: string, alias: string): Promise<void> {
	if (!alias || !isSafeAlias(alias)) return;
	const aliasPath = getAliasPath(alias);
	const target = `${sessionId}${SOCKET_SUFFIX}`;
	try {
		await fs.unlink(aliasPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "ENOENT") throw error;
	}
	try {
		await fs.symlink(target, aliasPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "EEXIST") throw error;
	}
}

export async function removeAliasesForSocket(socketPath: string | null): Promise<void> {
	if (!socketPath) return;
	try {
		const entries = await fs.readdir(CONTROL_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isSymbolicLink() || !entry.name.endsWith(ALIAS_SUFFIX)) continue;
			const aliasPath = join(CONTROL_DIR, entry.name);
			let target: string;
			try {
				target = await fs.readlink(aliasPath);
			} catch {
				continue;
			}
			const resolvedTarget = resolve(CONTROL_DIR, target);
			if (resolvedTarget === socketPath) {
				await fs.unlink(aliasPath);
			}
		}
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return;
		throw error;
	}
}

async function getAliasMap(): Promise<Map<string, string[]>> {
	const aliasMap = new Map<string, string[]>();
	let entries;
	try {
		entries = await fs.readdir(CONTROL_DIR, { withFileTypes: true });
	} catch {
		return aliasMap;
	}
	for (const entry of entries) {
		if (!entry.isSymbolicLink() || !entry.name.endsWith(ALIAS_SUFFIX)) continue;
		const aliasPath = join(CONTROL_DIR, entry.name);
		let target: string;
		try {
			target = await fs.readlink(aliasPath);
		} catch {
			continue;
		}
		const resolvedTarget = resolve(CONTROL_DIR, target);
		const aliases = aliasMap.get(resolvedTarget);
		const aliasName = entry.name.slice(0, -ALIAS_SUFFIX.length);
		if (aliases) {
			aliases.push(aliasName);
		} else {
			aliasMap.set(resolvedTarget, [aliasName]);
		}
	}
	return aliasMap;
}

// ─── Session Tags ─────────────────────────────────────────────────

export async function readTags(sessionId: string): Promise<SessionTags> {
	const tagsPath = getTagsPath(sessionId);
	try {
		const raw = await fs.readFile(tagsPath, "utf8");
		return JSON.parse(raw) as SessionTags;
	} catch {
		return {};
	}
}

export async function writeTags(sessionId: string, tags: SessionTags): Promise<void> {
	const tagsPath = getTagsPath(sessionId);
	await fs.writeFile(tagsPath, JSON.stringify(tags, null, 2), "utf8");
}

export async function removeTagsForSocket(sessionId: string): Promise<void> {
	const tagsPath = getTagsPath(sessionId);
	try {
		await fs.unlink(tagsPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "ENOENT") throw error;
	}
}

// ─── Live Sessions ────────────────────────────────────────────────

export async function getLiveSessions(
	tagFilter?: Partial<SessionTags>,
): Promise<LiveSessionInfo[]> {
	await ensureControlDir();
	let entries;
	try {
		entries = await fs.readdir(CONTROL_DIR, { withFileTypes: true });
	} catch {
		return [];
	}

	const aliasMap = await getAliasMap();
	const sessions: LiveSessionInfo[] = [];

	for (const entry of entries) {
		if (!entry.name.endsWith(SOCKET_SUFFIX)) continue;
		const socketPath = join(CONTROL_DIR, entry.name);
		const alive = await isSocketAlive(socketPath);
		if (!alive) continue;
		const sessionId = entry.name.slice(0, -SOCKET_SUFFIX.length);
		if (!isSafeSessionId(sessionId)) continue;

		const aliases = aliasMap.get(socketPath) ?? [];
		const name = aliases[0];
		const tags = await readTags(sessionId);

		// Apply tag filter
		if (tagFilter) {
			let matches = true;
			for (const [key, value] of Object.entries(tagFilter)) {
				if (value !== undefined && tags[key] !== value) {
					matches = false;
					break;
				}
			}
			if (!matches) continue;
		}

		sessions.push({ sessionId, name, aliases, tags, socketPath });
	}

	sessions.sort((a, b) => (a.name ?? a.sessionId).localeCompare(b.name ?? b.sessionId));
	return sessions;
}

// ─── Mailbox ──────────────────────────────────────────────────────

export async function writeMailboxMessage(
	sessionId: string,
	command: RpcSendCommand,
): Promise<void> {
	const mailboxPath = getMailboxPath(sessionId);
	const message: MailboxMessage = {
		queuedAt: Date.now(),
		retries: 0,
		command,
	};
	const line = JSON.stringify(message) + "\n";
	await fs.appendFile(mailboxPath, line, "utf8");
}

export async function drainMailbox(
	sessionId: string,
	maxRetries: number,
): Promise<RpcSendCommand[]> {
	const mailboxPath = getMailboxPath(sessionId);
	if (!existsSync(mailboxPath)) return [];

	let content: string;
	try {
		content = await fs.readFile(mailboxPath, "utf8");
	} catch {
		return [];
	}

	const lines = content.split("\n").filter((l) => l.trim());
	const remaining: MailboxMessage[] = [];

	for (const line of lines) {
		let msg: MailboxMessage;
		try {
			msg = JSON.parse(line) as MailboxMessage;
		} catch {
			continue;
		}

		if (msg.retries >= maxRetries) {
			// Move to dead mailbox
			const deadPath = mailboxPath + DEAD_SUFFIX;
			await fs.appendFile(deadPath, line + "\n", "utf8");
			continue;
		}

		remaining.push(msg);
	}

	// Clear mailbox. Messages that were successfully delivered are removed.
	// Remaining (not-yet-delivered) messages are re-written.
	if (remaining.length === 0) {
		await fs.unlink(mailboxPath);
	} else {
		const rewritten = remaining.map((m) => JSON.stringify(m)).join("\n") + "\n";
		await fs.writeFile(mailboxPath, rewritten, "utf8");
	}

	// Return commands for the caller to deliver (oldest first)
	return remaining
		.sort((a, b) => a.queuedAt - b.queuedAt)
		.map((m) => m.command);
}

export async function removeMailbox(sessionId: string): Promise<void> {
	const mailboxPath = getMailboxPath(sessionId);
	try {
		await fs.unlink(mailboxPath);
	} catch (error) {
		if (isErrnoException(error) && error.code !== "ENOENT") throw error;
	}
}

// ─── GC ───────────────────────────────────────────────────────────

export async function cleanupDeadSockets(deadRetentionDays: number): Promise<void> {
	await ensureControlDir();
	let entries;
	try {
		entries = await fs.readdir(CONTROL_DIR, { withFileTypes: true });
	} catch {
		return;
	}

	const cutoff = Date.now() - deadRetentionDays * 86400_000;

	for (const entry of entries) {
		// Clean up stale sockets
		if (entry.name.endsWith(SOCKET_SUFFIX)) {
			const socketPath = join(CONTROL_DIR, entry.name);
			const alive = await isSocketAlive(socketPath);
			if (alive) continue;

			const sessionId = entry.name.slice(0, -SOCKET_SUFFIX.length);
			await removeAliasesForSocket(socketPath);
			await removeSocket(socketPath);

			// Clean up old dead mailboxes
			const deadMailbox = getMailboxPath(sessionId) + DEAD_SUFFIX;
			try {
				const stat = await fs.stat(deadMailbox);
				if (stat.mtimeMs < cutoff) {
					await fs.unlink(deadMailbox);
				}
			} catch {
				// File doesn't exist — fine
			}
		}
	}
}

// ─── Helpers ──────────────────────────────────────────────────────

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

export function getBaseSessionId(sessionId: string): string {
	// sessionId may be a full UUID — extract the base part
	return sessionId;
}

export const __testing = {
	CONTROL_DIR,
	SOCKET_SUFFIX,
	ALIAS_SUFFIX,
	TAGS_SUFFIX,
	MAILBOX_SUFFIX,
	getAliasPath,
	getTagsPath,
	getMailboxPath,
};
