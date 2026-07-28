/**
 * shell/session.ts
 *
 * In-memory session bookkeeping (slugs, live/exited). Ported from
 * pi-shell-old/session-manager.ts (ShellSessionManager). Unifies the old
 * BackgroundSession/ActiveSession split into one LiveSession shape backed by
 * a RunRecord (recordId + launchToken) and a runtime.ts PtyRuntime. Unlike
 * the old manager, exit tracking is event-driven via markExited(), invoked
 * by callers from PtyRuntime's onExit callback -- no setInterval polling.
 */
import type { PtyRuntime } from "./runtime";

export interface LiveSession {
	sessionId: string;
	recordId: string;
	launchToken: string;
	command: string;
	reason?: string;
	runtime: PtyRuntime;
	startedAt: Date;
}

const SLUG_ADJECTIVES = [
	"amber", "brisk", "calm", "clear", "cool", "crisp", "dawn", "ember",
	"fast", "fresh", "gentle", "keen", "kind", "lucky", "mellow", "mild",
	"neat", "nimble", "nova", "quick", "quiet", "rapid", "sharp", "swift",
	"tender", "tidy", "vivid", "warm", "wild", "young",
];

const SLUG_NOUNS = [
	"atlas", "bloom", "breeze", "cedar", "cloud", "comet", "coral", "cove",
	"crest", "delta", "dune", "ember", "falcon", "fjord", "glade", "haven",
	"kelp", "lagoon", "meadow", "mist", "nexus", "orbit", "pine", "reef",
	"ridge", "river", "sage", "shell", "shore", "summit", "trail", "zephyr",
];

function randomChoice<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)] as T;
}

const usedIds = new Set<string>();

export function generateSessionId(name?: string): string {
	if (name) {
		let counter = 1;
		let id = name;
		while (usedIds.has(id)) {
			counter++;
			id = `${name}-${counter}`;
		}
		usedIds.add(id);
		return id;
	}

	for (let attempt = 0; attempt < 20; attempt++) {
		const adj = randomChoice(SLUG_ADJECTIVES);
		const noun = randomChoice(SLUG_NOUNS);
		const base = `${adj}-${noun}`;

		if (!usedIds.has(base)) {
			usedIds.add(base);
			return base;
		}

		for (let i = 2; i <= 9; i++) {
			const candidate = `${base}-${i}`;
			if (!usedIds.has(candidate)) {
				usedIds.add(candidate);
				return candidate;
			}
		}
	}

	const fallback = `shell-${Date.now().toString(36)}`;
	usedIds.add(fallback);
	return fallback;
}

export function releaseSessionId(id: string): void {
	usedIds.delete(id);
}

export class SessionRegistry {
	private sessions = new Map<string, LiveSession>();
	private changeListeners = new Set<() => void>();

	private notifyChange(): void {
		for (const listener of this.changeListeners) {
			try {
				listener();
			} catch (error) {
				console.error("pi-dispatch: session change listener error:", error);
			}
		}
	}

	onChange(cb: () => void): () => void {
		this.changeListeners.add(cb);
		return () => {
			this.changeListeners.delete(cb);
		};
	}

	add(entry: LiveSession): void {
		usedIds.add(entry.sessionId);
		this.sessions.set(entry.sessionId, entry);
		this.notifyChange();
	}

	get(sessionId: string): LiveSession | undefined {
		return this.sessions.get(sessionId);
	}

	take(sessionId: string): LiveSession | undefined {
		const entry = this.sessions.get(sessionId);
		if (entry) {
			this.sessions.delete(sessionId);
			this.notifyChange();
			return entry;
		}
		return undefined;
	}

	remove(sessionId: string): void {
		if (this.sessions.delete(sessionId)) {
			releaseSessionId(sessionId);
			this.notifyChange();
		}
	}

	list(): LiveSession[] {
		return Array.from(this.sessions.values());
	}

	markExited(_sessionId: string): void {
		this.notifyChange();
	}

	killAll(): void {
		for (const entry of this.sessions.values()) {
			try {
				entry.runtime.kill();
			} catch (error) {
				console.error(`pi-dispatch: failed to kill session ${entry.sessionId} during shutdown`, error);
			}
		}
	}
}
