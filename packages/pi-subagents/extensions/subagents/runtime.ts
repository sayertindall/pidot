/**
 * runtime.ts
 *
 * AgentManager: tracks agents, background concurrency queue, resume support.
 * Ports agent-manager.ts (631 lines) from the tintinweb/pi-subagents
 * reference. Background agents are subject to a configurable concurrency
 * limit (default 4); excess agents queue and auto-start as running agents
 * complete. Foreground agents bypass the queue entirely -- they block the
 * caller anyway. See SUB-SPEC-v4.md §4.1, §4.2, §4.5.
 *
 * Type -> AgentConfig resolution lives here (not discovery.ts): discovery.ts
 * owns parsing agent definition files and the three embedded defaults;
 * runtime.ts owns merging them into the registry a spawn call resolves
 * `type` against, cached per cwd so a background spawn doesn't re-scan disk.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_AGENTS, loadCustomAgents } from "./discovery.ts";
import { resumeAgent, runAgent, type ToolActivity } from "./session-runner.ts";
import type { AgentConfig, AgentInvocation, AgentRecord, IsolationMode, SubagentType, ThinkingLevel } from "./types.ts";
import { cleanupWorktree, createWorktree, pruneWorktrees } from "./worktree.ts";

export type OnAgentComplete = (record: AgentRecord) => void;
export type OnAgentStart = (record: AgentRecord) => void;
export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };
export type OnAgentCompact = (record: AgentRecord, info: CompactionInfo) => void;

const DEFAULT_MAX_CONCURRENT = 4;

/** `undefined`/`null` = unset (parent cwd). Anything else must be an absolute,
 * existing directory -- curated errors instead of TypeErrors from path/fs
 * internals (an RPC-style caller can send arbitrary JSON). */
function assertValidSpawnCwd(cwd: unknown): asserts cwd is string | undefined | null {
	if (cwd == null) return;
	if (typeof cwd !== "string" || !isAbsolute(cwd)) {
		throw new Error(`SpawnOptions.cwd must be an absolute path: "${String(cwd)}"`);
	}
	let isDirectory = false;
	try {
		isDirectory = statSync(cwd).isDirectory();
	} catch {
		throw new Error(`SpawnOptions.cwd does not exist: "${cwd}"`);
	}
	if (!isDirectory) throw new Error(`SpawnOptions.cwd is not a directory: "${cwd}"`);
}

/** Per-cwd agent-definition cache: project + workspace + global agents overlaid on the
 * three embedded defaults. Invalidate with `invalidateAgentRegistry(cwd)` after /agents edits. */
const registryCache = new Map<string, Map<string, AgentConfig>>();

function resolveAgentRegistry(cwd: string): Map<string, AgentConfig> {
	let registry = registryCache.get(cwd);
	if (!registry) {
		registry = new Map(DEFAULT_AGENTS);
		for (const [name, config] of loadCustomAgents(cwd)) registry.set(name, config);
		registryCache.set(cwd, registry);
	}
	return registry;
}

export function invalidateAgentRegistry(cwd: string): void {
	registryCache.delete(cwd);
}

export function resolveAgentConfig(type: SubagentType, cwd: string): AgentConfig | undefined {
	const registry = resolveAgentRegistry(cwd);
	if (registry.has(type)) return registry.get(type);
	const lower = type.toLowerCase();
	for (const [name, config] of registry) {
		if (name.toLowerCase() === lower) return config;
	}
	return undefined;
}

interface SpawnArgs {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	type: SubagentType;
	prompt: string;
	options: SpawnOptions;
}

export interface SpawnOptions {
	description: string;
	model?: Model<any>;
	maxTurns?: number;
	isolated?: boolean;
	inheritContext?: boolean;
	thinkingLevel?: ThinkingLevel;
	isBackground?: boolean;
	/** Skip the maxConcurrent queue check -- used by the scheduler so a fired job can't be deferred. */
	bypassQueue?: boolean;
	isolation?: IsolationMode;
	/** Working directory for the agent (absolute path). Default: parent session cwd. */
	cwd?: string;
	invocation?: AgentInvocation;
	signal?: AbortSignal;
	onToolActivity?: (activity: ToolActivity) => void;
	onTextDelta?: (delta: string, fullText: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	onTurnEnd?: (turnCount: number) => void;
	onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
	onCompaction?: (info: CompactionInfo) => void;
}

export class AgentManager {
	private agents = new Map<string, AgentRecord>();
	private cleanupInterval: ReturnType<typeof setInterval>;
	private onComplete?: OnAgentComplete;
	private onStart?: OnAgentStart;
	private onCompact?: OnAgentCompact;
	private maxConcurrent: number;
	/** Base repos worktrees were created from, so dispose() can prune all of them,
	 * not just the parent repo (a caller-supplied cwd can target other repos). */
	private worktreeRepos = new Set<string>();

	private queue: { id: string; args: SpawnArgs }[] = [];
	private runningBackground = 0;

	/** Called synchronously right after spawn, before onSessionCreated fires. */
	private onSpawned?: (id: string) => void;

	constructor(onComplete?: OnAgentComplete, maxConcurrent = DEFAULT_MAX_CONCURRENT, onStart?: OnAgentStart, onCompact?: OnAgentCompact) {
		this.onComplete = onComplete;
		this.onStart = onStart;
		this.onCompact = onCompact;
		this.maxConcurrent = maxConcurrent;
		this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
		this.cleanupInterval.unref();
	}

	setMaxConcurrent(n: number): void {
		this.maxConcurrent = Math.max(1, n);
		this.drainQueue();
	}

	getMaxConcurrent(): number {
		return this.maxConcurrent;
	}

	/** Spawn an agent and return its ID immediately (for background use). Queued past maxConcurrent. */
	spawn(pi: ExtensionAPI, ctx: ExtensionContext, type: SubagentType, prompt: string, options: SpawnOptions): string {
		assertValidSpawnCwd(options.cwd);

		const id = randomUUID().slice(0, 17);
		const abortController = new AbortController();
		const record: AgentRecord = {
			id,
			type,
			description: options.description,
			status: options.isBackground ? "queued" : "running",
			toolUses: 0,
			startedAt: Date.now(),
			abortController,
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			compactionCount: 0,
			isBackground: options.isBackground,
			invocation: options.invocation,
		};
		this.agents.set(id, record);

		const args: SpawnArgs = { pi, ctx, type, prompt, options };

		if (options.isBackground && !options.bypassQueue && this.runningBackground >= this.maxConcurrent) {
			this.queue.push({ id, args });
			return id;
		}

		try {
			this.startAgent(id, record, args);
		} catch (err) {
			this.agents.delete(id);
			throw err;
		}
		return id;
	}

	private startAgent(id: string, record: AgentRecord, { pi: _pi, ctx, type, prompt, options }: SpawnArgs): void {
		assertValidSpawnCwd(options.cwd);
		const customCwd = options.cwd ?? undefined;
		const baseCwd = customCwd ?? ctx.cwd;

		const agentConfig = resolveAgentConfig(type, baseCwd);
		if (!agentConfig) {
			throw new Error(`Unknown subagent type "${type}". Run /agents to see available types.`);
		}

		let worktreeCwd: string | undefined;
		if (options.isolation === "worktree") {
			const wt = createWorktree(baseCwd, id);
			if (!wt) {
				throw new Error(
					'Cannot run with isolation: "worktree" — not a git repo, no commits yet, or `git worktree add` failed. Initialize git and commit at least once, or omit `isolation`.',
				);
			}
			record.worktree = wt;
			worktreeCwd = customCwd !== undefined ? wt.workPath : wt.path;
			this.worktreeRepos.add(baseCwd);
		}

		record.status = "running";
		record.startedAt = Date.now();
		if (options.isBackground) this.runningBackground++;
		this.onStart?.(record);

		let detachParentSignal: (() => void) | undefined;
		if (options.signal) {
			const onParentAbort = () => this.abort(id);
			options.signal.addEventListener("abort", onParentAbort, { once: true });
			detachParentSignal = () => options.signal?.removeEventListener("abort", onParentAbort);
		}
		const detach = () => {
			detachParentSignal?.();
			detachParentSignal = undefined;
		};

		const promise = runAgent(ctx, type, prompt, {
			agentConfig,
			agentId: id,
			model: options.model,
			maxTurns: options.maxTurns,
			isolated: options.isolated,
			inheritContext: options.inheritContext,
			thinkingLevel: options.thinkingLevel,
			cwd: worktreeCwd ?? customCwd,
			configCwd: customCwd !== undefined ? ctx.cwd : undefined,
			signal: record.abortController?.signal,
			onToolActivity: (activity) => {
				if (activity.type === "end") record.toolUses++;
				options.onToolActivity?.(activity);
			},
			onTurnEnd: options.onTurnEnd,
			onTextDelta: options.onTextDelta,
			onAssistantUsage: (usage) => {
				record.lifetimeUsage.input += usage.input;
				record.lifetimeUsage.output += usage.output;
				record.lifetimeUsage.cacheWrite += usage.cacheWrite;
				options.onAssistantUsage?.(usage);
			},
			onCompaction: (info) => {
				record.compactionCount++;
				this.onCompact?.(record, info);
				options.onCompaction?.(info);
			},
			onSessionCreated: (session) => {
				record.session = session;
				if (record.pendingSteers?.length) {
					for (const msg of record.pendingSteers) session.steer(msg).catch(() => {});
					record.pendingSteers = undefined;
				}
				options.onSessionCreated?.(session);
			},
		})
			.then(({ responseText, session, aborted, steered, failure }) => {
				if (record.status !== "stopped") {
					if (aborted) record.status = "aborted";
					else if (failure) {
						record.status = "error";
						record.error = failure;
					} else record.status = steered ? "steered" : "completed";
				}
				record.result = responseText;
				record.session = session;
				record.completedAt ??= Date.now();
				detach();

				if (record.worktree) {
					const wtResult = cleanupWorktree(baseCwd, record.worktree, options.description);
					record.worktreeResult = wtResult;
					if (wtResult.hasChanges && wtResult.branch) {
						const repoNote = customCwd !== undefined ? ` in \`${baseCwd}\`` : "";
						record.result = `${record.result ?? ""}\n\n---\nChanges saved to branch \`${wtResult.branch}\`${repoNote}. Merge with: \`git merge ${wtResult.branch}\`${customCwd !== undefined ? ` (run in \`${baseCwd}\`)` : ""}`;
					}
				}

				if (!options.isBackground) {
					record.resultConsumed = true;
					try {
						this.onComplete?.(record);
					} catch {
						/* ignore completion side-effect errors */
					}
				} else {
					this.runningBackground--;
					try {
						this.onComplete?.(record);
					} catch {
						/* ignore completion side-effect errors */
					}
					this.drainQueue();
				}
				return responseText;
			})
			.catch((err) => {
				if (record.status !== "stopped") record.status = "error";
				record.error = err instanceof Error ? err.message : String(err);
				record.completedAt ??= Date.now();
				detach();

				if (record.worktree) {
					try {
						record.worktreeResult = cleanupWorktree(baseCwd, record.worktree, options.description);
					} catch {
						/* ignore cleanup errors */
					}
				}

				if (!options.isBackground) {
					record.resultConsumed = true;
					this.onComplete?.(record);
				} else {
					this.runningBackground--;
					this.onComplete?.(record);
					this.drainQueue();
				}
				return "";
			});

		record.promise = promise;
		this.onSpawned?.(id);
	}

	private drainQueue(): void {
		while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
			const next = this.queue.shift();
			if (!next) break;
			const record = this.agents.get(next.id);
			if (!record || record.status !== "queued") continue;
			try {
				this.startAgent(next.id, record, next.args);
			} catch (err) {
				record.status = "error";
				record.error = err instanceof Error ? err.message : String(err);
				record.completedAt = Date.now();
				this.onComplete?.(record);
			}
		}
	}

	/** Spawn and wait for completion (foreground use). Bypasses the concurrency queue. */
	async spawnAndWait(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		type: SubagentType,
		prompt: string,
		options: Omit<SpawnOptions, "isBackground">,
		onSpawned?: (id: string) => void,
	): Promise<{ id: string; record: AgentRecord }> {
		const prevOnSpawned = this.onSpawned;
		this.onSpawned = onSpawned;
		try {
			const id = this.spawn(pi, ctx, type, prompt, { ...options, isBackground: false });
			const record = this.agents.get(id);
			if (!record) throw new Error(`Spawned agent "${id}" vanished before it could be awaited.`);
			await record.promise;
			return { id, record };
		} finally {
			this.onSpawned = prevOnSpawned;
		}
	}

	/** Resume an existing agent session with a new prompt -- same session object, no respawn. */
	async resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined> {
		const record = this.agents.get(id);
		if (!record?.session) return undefined;

		record.status = "running";
		record.startedAt = Date.now();
		record.completedAt = undefined;
		record.result = undefined;
		record.error = undefined;

		try {
			const { text, failure } = await resumeAgent(record.session, prompt, {
				onToolActivity: (activity) => {
					if (activity.type === "end") record.toolUses++;
				},
				onAssistantUsage: (usage) => {
					record.lifetimeUsage.input += usage.input;
					record.lifetimeUsage.output += usage.output;
					record.lifetimeUsage.cacheWrite += usage.cacheWrite;
				},
				onCompaction: (info) => {
					record.compactionCount++;
					this.onCompact?.(record, info);
				},
				signal,
			});
			record.status = failure ? "error" : "completed";
			if (failure) record.error = failure;
			record.result = text;
			record.completedAt = Date.now();
		} catch (err) {
			record.status = "error";
			record.error = err instanceof Error ? err.message : String(err);
			record.completedAt = Date.now();
		}

		return record;
	}

	/** Steer a running (or queued, via pendingSteers) agent. Returns false if it can't accept steering. */
	steer(id: string, message: string): boolean {
		const record = this.agents.get(id);
		if (!record) return false;
		if (record.status !== "running" && record.status !== "queued") return false;
		if (record.session) {
			record.session.steer(message).catch(() => {});
		} else {
			(record.pendingSteers ??= []).push(message);
		}
		return true;
	}

	getRecord(id: string): AgentRecord | undefined {
		return this.agents.get(id);
	}

	listAgents(): AgentRecord[] {
		return [...this.agents.values()].sort((a, b) => b.startedAt - a.startedAt);
	}

	/** Human/system-initiated stop. See types.ts's TerminalStatus mapping (SUB-SPEC-v4.md §2.4):
	 * this always lands on "stopped", never "aborted" -- "aborted" is reserved for the internal
	 * turn-limit hard-abort in session-runner.ts's runAgent. */
	abort(id: string): boolean {
		const record = this.agents.get(id);
		if (!record) return false;

		if (record.status === "queued") {
			this.queue = this.queue.filter((q) => q.id !== id);
			record.status = "stopped";
			record.completedAt = Date.now();
			return true;
		}

		if (record.status !== "running") return false;
		record.abortController?.abort();
		record.status = "stopped";
		record.completedAt = Date.now();
		return true;
	}

	private removeRecord(id: string, record: AgentRecord): void {
		record.session?.dispose();
		record.session = undefined;
		this.agents.delete(id);
	}

	private cleanup(): void {
		const cutoff = Date.now() - 10 * 60_000;
		for (const [id, record] of this.agents) {
			if (record.status === "running" || record.status === "queued") continue;
			if ((record.completedAt ?? 0) >= cutoff) continue;
			this.removeRecord(id, record);
		}
	}

	/** Remove all completed/stopped/errored records immediately (e.g. on session start/switch).
	 * skipUnconsumed preserves records the caller hasn't read yet -- they're evicted by the
	 * 10-minute cleanup timer instead. */
	clearCompleted(skipUnconsumed = false): void {
		for (const [id, record] of this.agents) {
			if (record.status === "running" || record.status === "queued") continue;
			if (skipUnconsumed && !record.resultConsumed) continue;
			this.removeRecord(id, record);
		}
	}

	hasRunning(): boolean {
		return [...this.agents.values()].some((r) => r.status === "running" || r.status === "queued");
	}

	abortAll(): number {
		let count = 0;
		for (const queued of this.queue) {
			const record = this.agents.get(queued.id);
			if (record) {
				record.status = "stopped";
				record.completedAt = Date.now();
				count++;
			}
		}
		this.queue = [];
		for (const record of this.agents.values()) {
			if (record.status === "running") {
				record.abortController?.abort();
				record.status = "stopped";
				record.completedAt = Date.now();
				count++;
			}
		}
		return count;
	}

	async waitForAll(): Promise<void> {
		for (;;) {
			this.drainQueue();
			const pending = [...this.agents.values()]
				.filter((r) => r.status === "running" || r.status === "queued")
				.map((r) => r.promise)
				.filter((p): p is Promise<string> => Boolean(p));
			if (pending.length === 0) break;
			await Promise.allSettled(pending);
		}
	}

	dispose(): void {
		clearInterval(this.cleanupInterval);
		this.queue = [];
		for (const record of this.agents.values()) record.session?.dispose();
		this.agents.clear();
		try {
			pruneWorktrees(process.cwd());
		} catch {
			/* ignore */
		}
		for (const repo of this.worktreeRepos) {
			try {
				pruneWorktrees(repo);
			} catch {
				/* ignore */
			}
		}
	}
}
