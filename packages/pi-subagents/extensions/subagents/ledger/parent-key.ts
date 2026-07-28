/**
 * parent-key.ts — Persistent parent session key
 *
 * Survives session restarts. Stored in the filesystem, not in the session
 * file, so a fresh session can still find orphaned subagents.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const KEY_DIR = join(homedir(), ".pi", "agent", "pi-subagents");
const KEY_FILE = join(KEY_DIR, "parent-key");

let cachedKey: string | null = null;

export async function getOrCreateParentKey(): Promise<string> {
	if (cachedKey) return cachedKey;

	try {
		const raw = await readFile(KEY_FILE, "utf8");
		const key = raw.trim();
		if (key.length > 0) {
			cachedKey = key;
			return key;
		}
	} catch {
		// File doesn't exist — generate a new key
	}

	const key = `pk_${randomBytes(16).toString("hex")}`;
	await mkdir(KEY_DIR, { recursive: true });
	await writeFile(KEY_FILE, key, "utf8");
	cachedKey = key;
	return key;
}

export function getParentKeySync(): string | null {
	return cachedKey;
}
