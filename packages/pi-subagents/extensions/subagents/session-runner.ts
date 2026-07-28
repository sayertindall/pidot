/**
 * session-runner.ts
 *
 * Core execution engine for the in-process `pi` harness: builds a real
 * AgentSession via createAgentSession, wires tool scoping, runs the prompt
 * to completion (or resumes an existing session), and collects the result.
 * Ports the session-construction and turn-management halves of the
 * reference's agent-runner.ts (1,014 lines). See SUB-SPEC-v4.md §4.
 *
 * Deliberately out of scope for this pass (not part of SUB-SPEC-v4's stated
 * fixes, and each is a substantial feature in its own right in the
 * reference): persistent agent memory (memory.ts), skill preloading
 * (skill-loader.ts), environment-block prompt injection (env.ts), parent
 * conversation context blocks beyond a plain inheritContext prepend
 * (context.ts), and the full extensions:-array loader-level allowlist
 * (path entries, npm-package-name matching via extensionPackageName,
 * "*"-wildcard-with-excludes). What IS kept: extensions: true/false and a
 * plain by-name excludeExtensions/extensions[] filter, which covers the
 * common cases. Revisit if a project actually needs the dropped surface.
 */
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES, installExtensionToolScope, parseExtSelectors } from "./discovery.ts";
import { EXCLUDED_TOOL_NAMES, SUBAGENT_TOOL_NAMES } from "./types.ts";
import type { AgentConfig, SubagentType, ThinkingLevel } from "./types.ts";

export { EXCLUDED_TOOL_NAMES, SUBAGENT_TOOL_NAMES };

/** Additional turns allowed after the soft-limit steer message before a hard abort. */
let graceTurns = 5;
export function getGraceTurns(): number {
	return graceTurns;
}
export function setGraceTurns(n: number): void {
	graceTurns = Math.max(1, n);
}

let defaultMaxTurns: number | undefined;
export function getDefaultMaxTurns(): number | undefined {
	return defaultMaxTurns;
}
export function setDefaultMaxTurns(n: number | undefined): void {
	defaultMaxTurns = normalizeMaxTurns(n);
}

/** 0 or undefined = unlimited; otherwise clamp to a minimum of 1. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
	if (n == null || n === 0) return undefined;
	return Math.max(1, n);
}

/** Minimal duck-typed model registry -- avoids depending on the full ExtensionContext type here. */
interface ModelRegistryLike {
	find(provider: string, modelId: string): Model<any> | undefined;
	getAvailable?(): Array<{ provider: string; id: string }>;
}

/** Priority: explicit option > agent config's `model: "provider/id"` > parent model. */
function resolveDefaultModel(
	parentModel: Model<any> | undefined,
	registry: ModelRegistryLike,
	configModel: string | undefined,
): Model<any> | undefined {
	if (configModel) {
		const slashIdx = configModel.indexOf("/");
		if (slashIdx !== -1) {
			const provider = configModel.slice(0, slashIdx);
			const modelId = configModel.slice(slashIdx + 1);
			const available = registry.getAvailable?.();
			const isAvailable = !available || available.some((m) => m.provider === provider && m.id === modelId);
			const found = registry.find(provider, modelId);
			if (found && isAvailable) return found;
		}
	}
	return parentModel;
}

export interface ToolActivity {
	type: "start" | "end";
	toolName: string;
}

export interface RunOptions {
	agentConfig: AgentConfig;
	agentId?: string;
	model?: Model<any>;
	maxTurns?: number;
	signal?: AbortSignal;
	isolated?: boolean;
	inheritContext?: boolean;
	thinkingLevel?: ThinkingLevel;
	/** Override working directory (e.g. for worktree isolation). */
	cwd?: string;
	/** Where .pi config is discovered. Defaults to `cwd`. See SpawnOptions.cwd in runtime.ts:
	 * a caller-supplied cwd targeting a different repo keeps config with the parent project. */
	configCwd?: string;
	onToolActivity?: (activity: ToolActivity) => void;
	onTextDelta?: (delta: string, fullText: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	onTurnEnd?: (turnCount: number) => void;
	onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
	/** Prepended to the prompt when inheritContext is set. Caller builds this (runtime.ts),
	 * session-runner.ts just concatenates it -- keeps this file free of ExtensionContext internals. */
	parentContextBlock?: string;
}

export interface RunResult {
	responseText: string;
	session: AgentSession;
	/** True if hard-aborted (maxTurns + graceTurns exceeded). */
	aborted: boolean;
	/** True if steered to wrap up (hit the soft limit) but finished on its own. */
	steered: boolean;
	/** Set when the run's FINAL assistant turn failed (provider error, or a "length"
	 * stop with no text at all) -- distinct from a clean completion with real output. */
	failure?: string;
}

function collectResponseText(session: AgentSession) {
	let text = "";
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_start" && event.message.role === "assistant") {
			text = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			text += event.assistantMessageEvent.delta;
		}
	});
	return { getText: () => text, unsubscribe };
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
			.join("");
	}
	return "";
}

/** Bounded by startIndex so a resume with no new assistant message never inherits a prior turn's text. */
function getLastAssistantText(session: AgentSession, startIndex = 0): string {
	for (let i = session.messages.length - 1; i >= startIndex; i--) {
		const msg = session.messages[i];
		if (!msg || msg.role !== "assistant") continue;
		const text = extractText(msg.content).trim();
		if (text) return text;
	}
	return "";
}

/** Bounded by startIndex, same reasoning as getLastAssistantText. */
function finalTurnError(session: AgentSession, startIndex = 0): string | undefined {
	for (let i = session.messages.length - 1; i >= startIndex; i--) {
		const msg = session.messages[i];
		if (!msg || msg.role !== "assistant") continue;
		const stopReason = (msg as { stopReason?: string }).stopReason;
		if (stopReason === "error") {
			return (msg as { errorMessage?: string }).errorMessage?.trim() || "provider error with no output";
		}
		if (stopReason === "length" && !extractText(msg.content).trim()) {
			return "run hit the output token limit before producing any text";
		}
		return undefined;
	}
	return undefined;
}

function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
	if (!signal) return () => {};
	const onAbort = () => {
		session.abort();
	};
	signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

function resolveConfiguredSessionDir(sessionDir: string | undefined, cwd: string): string | undefined {
	if (!sessionDir) return undefined;
	if (sessionDir === "~" || sessionDir.startsWith("~/")) return resolve(homedir(), sessionDir.slice(2));
	if (isAbsolute(sessionDir)) return sessionDir;
	return resolve(cwd, sessionDir);
}

/** basename-derived canonical name: index.ts/.js -> parent dir name; otherwise basename minus .ts/.js. */
function canonicalExtensionName(extPath: string): string {
	const parts = extPath.split(/[\\/]/).filter(Boolean);
	const base = parts[parts.length - 1] ?? extPath;
	const name = base === "index.ts" || base === "index.js" ? (parts[parts.length - 2] ?? base) : base.replace(/\.(ts|js)$/, "");
	return name.toLowerCase();
}

interface SessionOptsExtra {
	excludeTools?: string[];
	thinkingLevel?: ThinkingLevel;
}

export async function runAgent(
	ctx: ExtensionContext,
	type: SubagentType,
	prompt: string,
	options: RunOptions,
): Promise<RunResult> {
	const agentConfig = options.agentConfig;
	const effectiveCwd = options.cwd ?? ctx.cwd;
	const configCwd = options.configCwd ?? effectiveCwd;

	const parentSystemPrompt = ctx.getSystemPrompt?.();
	const systemPrompt =
		agentConfig.promptMode === "append" && parentSystemPrompt
			? `${parentSystemPrompt}\n\n${agentConfig.systemPrompt}`
			: agentConfig.systemPrompt;

	const extensions = options.isolated ? false : agentConfig.extensions;
	const excludeExtensionNames = new Set((options.isolated ? [] : (agentConfig.excludeExtensions ?? [])).map((n) => n.toLowerCase()));
	const noExtensions = extensions === false;
	const loadAll = extensions === true;
	const keepNames = new Set(Array.isArray(extensions) ? extensions.map((n) => n.toLowerCase()) : []);

	const extensionsOverride: ((base: LoadExtensionsResult) => LoadExtensionsResult) | undefined =
		noExtensions || (loadAll && excludeExtensionNames.size === 0)
			? undefined
			: (base) => ({
					...base,
					extensions: base.extensions.filter((e) => {
						const name = canonicalExtensionName(e.path);
						if (excludeExtensionNames.has(name)) return false;
						return loadAll || keepNames.has(name);
					}),
				});

	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(configCwd, agentDir);
	const configuredSessionDir = resolveConfiguredSessionDir(agentConfig.sessionDir, effectiveCwd);
	const sessionManager = agentConfig.persistSession
		? SessionManager.create(effectiveCwd, configuredSessionDir)
		: SessionManager.inMemory(effectiveCwd);

	const loader = new DefaultResourceLoader({
		cwd: configCwd,
		agentDir,
		settingsManager,
		noExtensions,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionsOverride,
		systemPromptOverride: () => systemPrompt,
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();

	const { extNames, narrowing } = parseExtSelectors(options.isolated ? [] : (agentConfig.extSelectors ?? []));
	const disallowedSet = agentConfig.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;
	const toolNames = (agentConfig.builtinToolNames?.length ? agentConfig.builtinToolNames : BUILTIN_TOOL_NAMES).filter(
		(t) => !EXCLUDED_TOOL_NAMES.includes(t),
	);

	let sessionTools: string[] | undefined;
	const sessionExtra: SessionOptsExtra = {};
	if (noExtensions) {
		sessionTools = toolNames.filter((t) => !disallowedSet?.has(t));
	} else {
		const denyTools = new Set<string>(EXCLUDED_TOOL_NAMES);
		for (const name of BUILTIN_TOOL_NAMES) {
			if (!toolNames.includes(name)) denyTools.add(name);
		}
		if (disallowedSet) for (const name of disallowedSet) denyTools.add(name);
		sessionExtra.excludeTools = [...denyTools];
	}
	if (options.thinkingLevel) sessionExtra.thinkingLevel = options.thinkingLevel;

	const model =
		options.model ?? resolveDefaultModel(ctx.model as Model<any> | undefined, ctx.modelRegistry as unknown as ModelRegistryLike, agentConfig.model);

	// CreateAgentSessionOptions takes modelRuntime, not modelRegistry -- ExtensionContext only
	// exposes the registry facade, so pull the underlying runtime off it the same way the
	// reference does, and fall back to createAgentSession's own default (agentDir/auth.json)
	// when it isn't present.
	const parentModelRuntime = (ctx.modelRegistry as unknown as { runtime?: unknown }).runtime;

	const { session } = await createAgentSession({
		cwd: effectiveCwd,
		agentDir,
		sessionManager,
		settingsManager,
		...(parentModelRuntime ? { modelRuntime: parentModelRuntime as never } : {}),
		model,
		tools: sessionTools,
		resourceLoader: loader,
		...(sessionExtra.excludeTools ? { excludeTools: sessionExtra.excludeTools } : {}),
		...(sessionExtra.thinkingLevel ? { thinkingLevel: sessionExtra.thinkingLevel } : {}),
	});

	const baseSessionName = agentConfig.name ?? type;
	session.setSessionName(options.agentId ? `${baseSessionName}#${options.agentId.slice(0, 8)}` : baseSessionName);

	await session.bindExtensions({
		onError: (err) => {
			options.onToolActivity?.({ type: "end", toolName: `extension-error:${err.extensionPath}` });
		},
	});

	if (!noExtensions) {
		installExtensionToolScope(session, { loader, toolNames, disallowedSet, extNames, narrowing });
	}

	options.onSessionCreated?.(session);

	let turnCount = 0;
	const maxTurns = normalizeMaxTurns(options.maxTurns ?? agentConfig.maxTurns ?? defaultMaxTurns);
	let softLimitReached = false;
	let aborted = false;
	let currentMessageText = "";

	const unsubTurns = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "turn_end") {
			turnCount++;
			options.onTurnEnd?.(turnCount);
			if (maxTurns != null) {
				if (!softLimitReached && turnCount >= maxTurns) {
					softLimitReached = true;
					session.steer("You have reached your turn limit. Wrap up immediately — provide your final answer now.");
				} else if (softLimitReached && turnCount >= maxTurns + graceTurns) {
					aborted = true;
					session.abort();
				}
			}
		}
		if (event.type === "message_start") currentMessageText = "";
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentMessageText += event.assistantMessageEvent.delta;
			options.onTextDelta?.(event.assistantMessageEvent.delta, currentMessageText);
		}
		if (event.type === "tool_execution_start") {
			options.onToolActivity?.({ type: "start", toolName: event.toolName });
		}
		if (event.type === "tool_execution_end") {
			options.onToolActivity?.({ type: "end", toolName: event.toolName });
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const u = (event.message as { usage?: { input?: number; output?: number; cacheWrite?: number } }).usage;
			if (u) options.onAssistantUsage?.({ input: u.input ?? 0, output: u.output ?? 0, cacheWrite: u.cacheWrite ?? 0 });
		}
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
		}
	});

	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	let effectivePrompt = prompt;
	if (options.inheritContext && options.parentContextBlock) {
		effectivePrompt = options.parentContextBlock + prompt;
	}

	const startLen = session.messages.length;
	try {
		await session.prompt(effectivePrompt);
	} finally {
		unsubTurns();
		collector.unsubscribe();
		cleanupAbort();
	}

	const responseText = collector.getText().trim() || getLastAssistantText(session, startLen);
	return { responseText, session, aborted, steered: softLimitReached, failure: finalTurnError(session, startLen) };
}

export async function resumeAgent(
	session: AgentSession,
	prompt: string,
	options: {
		onToolActivity?: (activity: ToolActivity) => void;
		onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
		onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
		signal?: AbortSignal;
	} = {},
): Promise<{ text: string; failure?: string }> {
	const startLen = session.messages.length;
	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "tool_execution_start") options.onToolActivity?.({ type: "start", toolName: event.toolName });
		if (event.type === "tool_execution_end") options.onToolActivity?.({ type: "end", toolName: event.toolName });
		if (event.type === "message_end" && event.message.role === "assistant") {
			const u = (event.message as { usage?: { input?: number; output?: number; cacheWrite?: number } }).usage;
			if (u) options.onAssistantUsage?.({ input: u.input ?? 0, output: u.output ?? 0, cacheWrite: u.cacheWrite ?? 0 });
		}
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore });
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		unsubscribe();
		collector.unsubscribe();
		cleanupAbort();
	}

	const text = collector.getText().trim() || getLastAssistantText(session, startLen);
	return { text, failure: finalTurnError(session, startLen) };
}
