import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { isEnoent } from "./types";

const PACKAGE_NAME = "pi-runtime-quit-and-delete";
const ENV_VAR = "PI_QUIT_AND_DELETE_SHORTCUT";
const DEFAULT_SHORTCUT: KeyId = "ctrl+shift+x" as KeyId;

function resolveShortcut(): KeyId {
	const env = process.env[ENV_VAR];
	if (env) return env as KeyId;

	try {
		const settingsPath = join(getAgentDir(), "settings.json");
		const raw = readFileSync(settingsPath, "utf-8");
		const settings = JSON.parse(raw) as Record<string, unknown>;
		const ext = settings[PACKAGE_NAME] as Record<string, unknown> | undefined;
		if (typeof ext?.shortcut === "string") {
			return ext.shortcut as KeyId;
		}
	} catch {
		// settings.json missing or malformed — ignore
	}

	return DEFAULT_SHORTCUT;
}

export default function quitAndDeleteExtension(pi: ExtensionAPI): void {
	const shortcut = resolveShortcut();

	pi.registerShortcut(shortcut, {
		description: "Quit pi and permanently delete the active session file",
		handler: async (ctx) => {
			const sessionFile = ctx.sessionManager.getSessionFile();

			if (sessionFile) {
				try {
					await unlink(sessionFile);
				} catch (err) {
					if (!isEnoent(err)) {
						const message = err instanceof Error ? err.message : String(err);
						process.stderr.write(`pi-runtime-quit-and-delete: failed to delete session: ${message}\n`);
					}
					// still exit — user's intent is to quit
				}
			}

			process.exit(0);
		},
	});
}
