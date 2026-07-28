import { SessionManager, type SessionManager as SessionManagerType } from "@earendil-works/pi-coding-agent";
import type { CoachScope } from "./types";

export async function listSessionsAll(cwd: string, sessionDir: string): Promise<Array<{ path: string; created: Date }>> {
	const sessions = await SessionManager.list(cwd, sessionDir);
	return sessions
		.map((s) => ({ path: s.path, created: s.created }))
		.sort((a, b) => b.created.getTime() - a.created.getTime());
}

export function openSession(sessionPath: string): SessionManagerType {
	return SessionManager.open(sessionPath);
}

export function resolveScope(scope: CoachScope, cwd: string, sessionDir: string): Promise<Array<{ path: string; created: Date }>> {
	if (scope === "current") return Promise.resolve([]);
	return listSessionsAll(cwd, sessionDir);
}
