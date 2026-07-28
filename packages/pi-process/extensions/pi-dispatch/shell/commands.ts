/**
 * shell/commands.ts
 *
 * The `interactive_shell` tool's execute() handler plus the /spawn, /attach,
 * /dismiss command handlers. All four share one core: dispatch() (implements
 * ShellApi from types.ts) and the query/kill/background/attach/dismiss
 * helpers below it. index.ts only wires these into pi.registerTool /
 * pi.registerCommand -- no branching logic lives there.
 *
 * Contract selection (completion.ts): interactive mode uses "exit-code" --
 * the user is watching, PTY exit code is ground truth. hands-free, dispatch,
 * and monitor are headless: nobody is watching, so the sentinel (§4) wraps
 * the command and gives HeadlessSupervisor a reliable "actually done" signal
 * instead of relying on quiet-detection/exit-code heuristics alone.
 *
 * Scope note: the old package's handoff-snapshot-to-file feature and its
 * external monitor-trigger detector-command feature are not ported here --
 * neither is part of the fixed spec surface (§8's "public surface" list
 * doesn't call either out), and porting them added real scope for no known
 * bug fix. handoffPreview (tail-lines-in-result) is a straightforward
 * capture and is kept.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { legacyFields, resolve, type Termination, type TerminationCause } from "./completion";
import { loadConfig, type DispatchConfig } from "./config";
import { DispatchCoordinator } from "./coordinator";
import { translateInput } from "./key-encoding";
import {
	buildDispatchNotification,
	buildMonitorEventNotification,
	buildMonitorLifecycleNotification,
	buildResultNotification,
	type CompletionOutput,
} from "./notification";
import { openOverlay } from "./overlay";
// TOOL_NAME imported by other modules that re-export from schemas
import { generateSessionId, type LiveSession, SessionRegistry } from "./session";
import { parseSpawnArgs, resolveSpawn } from "./spawn";
import { createRunRecord, deleteRunRecord, findBySessionId, mutateRunRecord } from "./state";
import {
	HeadlessSupervisor,
	type HeadlessSupervisorOptions,
	type MonitorMatchInfo,
	type SupervisionResult,
} from "./supervision";
import { sentinelLiteral, wrapForSentinel } from "./sentinel";
import { PtyRuntime } from "./runtime";
import type {
	DispatchHandle,
	DispatchRequest,
	DispatchResult,
	InputSpec,
	MonitorConfig,
	MonitorTerminalReason,
	SessionSummary,
	ShellApi,
	SpawnAgent,
	SpawnMode,
	SupervisionMode,
	WorktreePolicy,
} from "./types";
import { formatDuration } from "./types";

function text(s: string): TextContent[] {
	return [{ type: "text", text: s }];
}

function toolResult(content: string, details: unknown = {}): AgentToolResult<unknown> {
	return { content: text(content), details };
}

// --- runtime bundle: everything the tool/commands share, one per extension load ---

interface RuntimeSession {
	session: LiveSession;
	mode: SupervisionMode;
	background: boolean;
	monitor?: MonitorConfig;
	agent?: SpawnAgent;
	spawnMode?: SpawnMode;
	worktreePath?: string;
	worktreePolicy: WorktreePolicy;
	supervisor?: HeadlessSupervisor;
	deferred: { promise: Promise<DispatchResult>; resolve: (r: DispatchResult) => void };
	settled: boolean;
}

export interface ShellRuntime {
	api: ShellApi;
	registry: SessionRegistry;
	coordinator: DispatchCoordinator;
	configFor(cwd: string): DispatchConfig;
	shutdown(): void;
}

export function createShellRuntime(pi: ExtensionAPI): ShellRuntime {
	const registry = new SessionRegistry();
	const coordinator = new DispatchCoordinator();
	const runtimeSessions = new Map<string, RuntimeSession>();
	const configCache = new Map<string, DispatchConfig>();

	function configFor(cwd: string): DispatchConfig {
		let cfg = configCache.get(cwd);
		if (!cfg) {
			cfg = loadConfig(cwd);
			configCache.set(cwd, cfg);
		}
		return cfg;
	}

	function contractFor(mode: SupervisionMode): "sentinel" | "exit-code" {
		return mode === "interactive" ? "exit-code" : "sentinel";
	}

	function toDispatchResult(sessionId: string, termination: Termination): DispatchResult {
		const resolution = resolve(termination);
		const legacy = legacyFields(termination);
		return {
			status: resolution.status,
			sessionId,
			exitCode: legacy.exitCode,
			signal: termination.signal ?? undefined,
			cancelled: legacy.cancelled,
			timedOut: legacy.timedOut,
		};
	}

	async function persistTerminal(rt: RuntimeSession, termination: Termination, result: DispatchResult): Promise<void> {
		await mutateRunRecord(rt.session.recordId, rt.session.launchToken, (current) => ({
			...current,
			status: result.status,
			terminationCause: termination.cause,
			exitCode: result.exitCode,
			signal: result.signal ?? null,
			endedAt: new Date().toISOString(),
		}));
	}

	function notifyIfNotAgentHandled(rt: RuntimeSession, result: DispatchResult, termination: Termination, completionOutput?: CompletionOutput): void {
		const handled = coordinator.consumeAgentHandled(rt.session.launchToken);
		if (handled) return;
		if (rt.mode === "monitor") return; // monitor completion notified via monitor-lifecycle path, not here
		const duration = formatDuration(Date.now() - rt.session.startedAt.getTime());
		const content = rt.mode === "dispatch"
			? buildDispatchNotification(rt.session.sessionId, result, termination, duration, completionOutput)
			: buildResultNotification(rt.session.sessionId, result, termination, completionOutput);
		pi.sendMessage(
			{
				customType: "interactive-shell-transfer",
				content,
				display: true,
				details: { ...result },
			},
			{ triggerTurn: true },
		);
	}

	function attachHeadlessSupervisor(
		rt: RuntimeSession,
		config: DispatchConfig,
		expectSentinel: { recordId: string; launchToken: string } | undefined,
		options: { autoExitOnQuiet: boolean; quietThreshold: number; gracePeriod?: number; timeout?: number },
	): HeadlessSupervisor {
		const monitor = rt.monitor;
		const supervisorOptions: HeadlessSupervisorOptions = {
			autoExitOnQuiet: options.autoExitOnQuiet,
			quietThreshold: options.quietThreshold,
			gracePeriod: options.gracePeriod,
			timeout: options.timeout,
			monitor,
			sentinel: expectSentinel,
			startedAt: rt.session.startedAt.getTime(),
			onMonitorEvent: monitor
				? (event: MonitorMatchInfo) => {
						const payload = coordinator.recordMonitorEvent({
							sessionId: rt.session.sessionId,
							strategy: event.strategy,
							triggerId: event.triggerId,
							eventType: event.eventType,
							matchedText: event.matchedText,
							lineOrDiff: event.lineOrDiff,
							stream: event.stream,
						});
						pi.sendMessage(
							{
								customType: "interactive-shell-monitor-event",
								content: buildMonitorEventNotification(payload),
								display: true,
								details: payload,
							},
							{ triggerTurn: true },
						);
						const persistence = monitor.persistence;
						if (persistence?.stopAfterFirstEvent || (persistence?.maxEvents && payload.eventId >= persistence.maxEvents)) {
							coordinator.markMonitorStopping(rt.session.sessionId, "stopped");
							rt.session.runtime.kill();
						}
					}
				: undefined,
		};

		const supervisor = new HeadlessSupervisor(
			rt.session.runtime,
			config,
			supervisorOptions,
			(supervisionResult: SupervisionResult) => {
				void handleSupervisionComplete(rt, supervisionResult);
			},
		);
		rt.supervisor = supervisor;
		coordinator.setMonitor(rt.session.sessionId, supervisor);
		if (monitor) {
			coordinator.registerMonitorSession(rt.session.sessionId, monitor, rt.session.startedAt);
		}
		return supervisor;
	}

	async function handleSupervisionComplete(rt: RuntimeSession, sr: SupervisionResult): Promise<void> {
		const result = toDispatchResult(rt.session.sessionId, sr.termination);
		await persistTerminal(rt, sr.termination, result);

		if (rt.monitor) {
			const pending = coordinator.consumePendingMonitorReason(rt.session.sessionId);
			const reason: MonitorTerminalReason = pending ?? monitorReasonFromResult(sr.termination, result);
			const state = coordinator.finalizeMonitorSession(
				rt.session.sessionId,
				{ exitCode: result.exitCode, signal: result.signal },
				reason,
			);
			const handled = coordinator.consumeAgentHandled(rt.session.launchToken);
			if (!handled && state) {
				pi.sendMessage(
					{
						customType: "interactive-shell-monitor-lifecycle",
						content: buildMonitorLifecycleNotification(state),
						display: true,
						details: { sessionId: rt.session.sessionId, state },
					},
					{ triggerTurn: true },
				);
			}
			coordinator.deleteMonitor(rt.session.sessionId);
		} else {
			notifyIfNotAgentHandled(rt, result, sr.termination, sr.completionOutput);
			coordinator.deleteMonitor(rt.session.sessionId);
		}

		if (!rt.settled) {
			rt.settled = true;
			rt.deferred.resolve(result);
		}
	}

	function monitorReasonFromResult(termination: Termination, result: DispatchResult): MonitorTerminalReason {
		if (termination.cause === "timeout") return "timed-out";
		if (result.status === "stopped") return "stopped";
		if (result.status === "completed") return "stream-ended";
		return "script-failed";
	}

	function makeDeferred(): { promise: Promise<DispatchResult>; resolve: (r: DispatchResult) => void } {
		let resolveFn!: (r: DispatchResult) => void;
		const promise = new Promise<DispatchResult>((res) => {
			resolveFn = res;
		});
		return { promise, resolve: resolveFn };
	}

	function makeHandle(rt: RuntimeSession): DispatchHandle {
		return {
			sessionId: rt.session.sessionId,
			runToken: rt.session.launchToken,
			settled: rt.deferred.promise,
			write(input: InputSpec) {
				if (rt.session.runtime.exited) return false;
				rt.session.runtime.write(translateInput(input as never));
				return true;
			},
			kill(cause: "agent_kill" | "user_kill") {
				coordinator.markAgentHandled(rt.session.launchToken, "kill");
				if (rt.supervisor && !rt.supervisor.disposed) {
					rt.session.runtime.kill();
					rt.supervisor.handleExternalCompletion(cause, rt.session.runtime.exitCode, rt.session.runtime.signal);
				} else {
					rt.session.runtime.kill();
				}
			},
			suppressNotification() {
				coordinator.markAgentHandled(rt.session.launchToken, "wait");
			},
			events() {
				return coordinator.getMonitorEvents(rt.session.sessionId).events;
			},
		};
	}

	async function resolveCommand(
		ctx: ExtensionContext,
		config: DispatchConfig,
		request: DispatchRequest,
	): Promise<{
		rawCommand: string;
		cwd: string;
		reason?: string;
		agent?: SpawnAgent;
		spawnMode?: SpawnMode;
		worktreePath?: string;
		worktreePolicy: WorktreePolicy;
	}> {
		if (request.command && request.spawn) {
			throw new Error("Use either 'command' or 'spawn', not both.");
		}
		if (request.spawn) {
			const resolved = resolveSpawn(config, request.cwd ?? ctx.cwd, request.spawn, () => ctx.sessionManager.getSessionFile());
			if (!resolved.ok) throw new Error(resolved.error);
			const reason = request.reason ? `${request.reason} • ${resolved.spawn.reason}` : resolved.spawn.reason;
			return {
				rawCommand: resolved.spawn.command,
				cwd: resolved.spawn.cwd,
				reason,
				agent: resolved.spawn.agent,
				spawnMode: resolved.spawn.mode,
				worktreePath: resolved.spawn.worktreePath,
				worktreePolicy: resolved.spawn.worktreePolicy,
			};
		}
		if (request.command) {
			return {
				rawCommand: request.command,
				cwd: request.cwd ?? ctx.cwd,
				reason: request.reason,
				worktreePolicy: config.spawn.worktreePolicy,
			};
		}
		throw new Error("One of 'command' or 'spawn' is required to start a new session.");
	}

	async function dispatch(ctx: ExtensionContext, request: DispatchRequest): Promise<DispatchHandle> {
		const config = configFor(request.cwd ?? ctx.cwd);
		const resolved = await resolveCommand(ctx, config, request);
		const contract = contractFor(request.mode);
		const sessionId = generateSessionId(request.name);
		const execCommand = contract === "sentinel" ? wrapForSentinel(resolved.rawCommand, request.recordId, request.launchToken) : resolved.rawCommand;

		const runtime = new PtyRuntime(
			{
				command: execCommand,
				cwd: resolved.cwd,
				scrollback: config.scrollbackLines,
				ansiReemit: config.ansiReemit,
			},
			{},
		);

		const session: LiveSession = {
			sessionId,
			recordId: request.recordId,
			launchToken: request.launchToken,
			command: resolved.rawCommand,
			reason: resolved.reason,
			runtime,
			startedAt: new Date(),
		};
		runtime.addExitListener(() => registry.markExited(sessionId));

		// createRunRecord adds to index synchronously BEFORE registry.add
		// fires onChange, so the widget picks up the new record immediately.
		await createRunRecord({
			schemaVersion: 1,
			recordId: request.recordId,
			launchToken: request.launchToken,
			agent: resolved.agent,
			task: resolved.reason,
			command: resolved.rawCommand,
			execCommand,
			cwd: resolved.cwd,
			worktree: Boolean(resolved.worktreePath),
			worktreePath: resolved.worktreePath,
			worktreePolicy: resolved.worktreePolicy,
			supervision: request.mode,
			completionContract: contract,
			sentinel: contract === "sentinel" ? sentinelLiteral(request.recordId, request.launchToken) : undefined,
			sessionId,
			ptyPid: runtime.pid,
			ptyPgid: runtime.pgid,
			status: "running",
			createdAt: session.startedAt.toISOString(),
			startedAt: session.startedAt.toISOString(),
			updatedAt: session.startedAt.toISOString(),
		});

		// Now that the index is populated, register the session so the widget
		// picks it up on the onChange-triggered render.
		registry.add(session);

		const rt: RuntimeSession = {
			session,
			mode: request.mode,
			background: Boolean(request.background),
			monitor: request.monitor,
			agent: resolved.agent,
			spawnMode: resolved.spawnMode,
			worktreePath: resolved.worktreePath,
			worktreePolicy: resolved.worktreePolicy,
			deferred: makeDeferred(),
			settled: false,
		};
		runtimeSessions.set(sessionId, rt);

		if (request.mode === "interactive") {
			void runInteractive(ctx, config, rt);
		} else {
			const autoExitOnQuiet = request.handsFree?.autoExitOnQuiet ?? (request.mode === "dispatch");
			attachHeadlessSupervisor(
				rt,
				config,
				contract === "sentinel" ? { recordId: request.recordId, launchToken: request.launchToken } : undefined,
				{
					autoExitOnQuiet,
					quietThreshold: request.handsFree?.quietThreshold ?? config.handsFreeQuietThreshold,
					gracePeriod: request.handsFree?.gracePeriod ?? config.autoExitGracePeriod,
					timeout: request.timeout,
				},
			);
		}

		return makeHandle(rt);
	}

	async function runInteractive(ctx: ExtensionContext, config: DispatchConfig, rt: RuntimeSession): Promise<void> {
		const outcome = await openOverlay(pi, ctx, rt.session, coordinator, config).catch((error: unknown) => {
			console.error("pi-dispatch: overlay error:", error);
			return "exited" as const;
		});

		if (outcome === "background") {
			const autoExitOnQuiet = false;
			attachHeadlessSupervisor(rt, config, undefined, {
				autoExitOnQuiet,
				quietThreshold: config.handsFreeQuietThreshold,
				gracePeriod: config.autoExitGracePeriod,
			});
			await mutateRunRecord(rt.session.recordId, rt.session.launchToken, (current) => ({ ...current }));
			return;
		}

		const cause: TerminationCause = outcome === "kill" ? "user_kill" : outcome === "transfer" ? "transfer" : "child_exit";
		const termination: Termination = {
			cause,
			contract: "exit-code",
			exitCode: rt.session.runtime.exitCode,
			signal: rt.session.runtime.signal ?? null,
			sentinelSeen: false,
			sentinelExitCode: null,
		};
		const result = toDispatchResult(rt.session.sessionId, termination);
		await persistTerminal(rt, termination, result);
		rt.settled = true;
		rt.deferred.resolve(result);
	}

	async function attach(sessionId: string): Promise<{ sessionId: string; handle: DispatchHandle } | undefined> {
		const rt = runtimeSessions.get(sessionId);
		if (!rt) return undefined;
		return { sessionId, handle: makeHandle(rt) };
	}

	function list(): readonly SessionSummary[] {
		return registry.list().map((s) => {
			const rt = runtimeSessions.get(s.sessionId);
			return {
				sessionId: s.sessionId,
				command: s.command,
				reason: s.reason,
				exited: s.runtime.exited,
				startedAt: s.startedAt.getTime(),
				monitor: coordinator.getMonitorSessionState(s.sessionId),
			} satisfies SessionSummary;
			void rt;
		});
	}

	function get(sessionId: string): DispatchHandle | undefined {
		const rt = runtimeSessions.get(sessionId);
		return rt ? makeHandle(rt) : undefined;
	}

	const api: ShellApi = { dispatch, attach, list, get };

	return {
		api,
		registry,
		coordinator,
		configFor,
		shutdown() {
			for (const rt of runtimeSessions.values()) {
				rt.supervisor?.dispose();
			}
			registry.killAll();
			coordinator.disposeAllMonitors();
		},
	};
}

// --- tool execute() handler ---

interface ToolParams {
	command?: string;
	spawn?: { agent?: SpawnAgent; mode?: SpawnMode; worktree?: boolean; prompt?: string };
	sessionId?: string;
	kill?: boolean;
	outputLines?: number;
	outputMaxChars?: number;
	drain?: boolean;
	input?: string;
	submit?: boolean;
	inputKeys?: string[];
	inputHex?: string[];
	inputPaste?: string;
	cwd?: string;
	name?: string;
	reason?: string;
	mode?: SupervisionMode;
	monitor?: MonitorConfig;
	background?: boolean;
	attach?: string;
	listBackground?: boolean;
	dismissBackground?: boolean | string;
	handsFree?: { updateInterval?: number; quietThreshold?: number; gracePeriod?: number; autoExitOnQuiet?: boolean };
	timeout?: number;
}

function newRecordIds(): { recordId: string; launchToken: string } {
	return { recordId: randomUUID(), launchToken: randomUUID() };
}

export async function handleToolExecute(
	rt: ShellRuntime,
	pi: ExtensionAPI,
	params: ToolParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
	if (params.spawn && (params.sessionId || params.attach || params.listBackground || params.dismissBackground)) {
		return toolResult("'spawn' is only valid when starting a new session.");
	}

	if (params.sessionId) {
		return handleExistingSession(rt, params.sessionId, params);
	}
	if (params.attach) {
		return handleAttach(rt, pi, ctx, params.attach, params.mode ?? "interactive");
	}
	if (params.listBackground) {
		return handleListBackground(rt);
	}
	if (params.dismissBackground !== undefined) {
		return handleDismissBackground(rt, params.dismissBackground);
	}

	if (!params.command && !params.spawn) {
		return toolResult(
			"One of 'command', 'spawn', 'sessionId', 'attach', 'listBackground', or 'dismissBackground' is required.",
		);
	}

	const mode: SupervisionMode = params.mode ?? "interactive";
	if (params.background && mode !== "dispatch" && mode !== "monitor") {
		return toolResult("background: true requires mode='dispatch' or mode='monitor' for new sessions.");
	}
	if (mode !== "monitor" && mode !== "dispatch" && !ctx.hasUI) {
		return toolResult(`mode='${mode}' requires an interactive UI.`);
	}
	if (mode === "interactive" && rt.coordinator.isOverlayOpen()) {
		return toolResult("An overlay is already open. Finish or background it before starting another interactive session.");
	}
	if (mode === "monitor" && (!params.monitor || params.monitor.triggers.length === 0)) {
		return toolResult("mode='monitor' requires monitor.triggers.");
	}

	const { recordId, launchToken } = newRecordIds();
	let handle: DispatchHandle;
	try {
		handle = await rt.api.dispatch(ctx, {
			recordId,
			launchToken,
			command: params.command,
			spawn: params.spawn ? { agent: params.spawn.agent as SpawnAgent, mode: params.spawn.mode as SpawnMode, worktree: params.spawn.worktree, prompt: params.spawn.prompt } : undefined,
			cwd: params.cwd,
			name: params.name,
			reason: params.reason,
			mode,
			background: params.background,
			monitor: params.monitor,
			handsFree: params.handsFree,
			timeout: params.timeout,
		});
	} catch (error) {
		return toolResult(error instanceof Error ? error.message : String(error));
	}

	if (mode === "interactive") {
		const result = await handle.settled;
		return toolResult(
			result.status === "completed" ? `Session ended successfully` : `Session ended (${result.status})`,
			{ ...result },
		);
	}
	if (mode === "monitor") {
		const triggerIds = params.monitor?.triggers.map((t) => t.id).join(", ") ?? "";
		return toolResult(
			`Monitor started in background (id: ${handle.sessionId}).\nStrategy: ${params.monitor?.strategy ?? "stream"}\nTriggers: ${triggerIds}\nYou'll be notified when a trigger emits an event.`,
			{ sessionId: handle.sessionId, status: "running" },
		);
	}
	if (mode === "dispatch" && params.background) {
		return toolResult(
			`Session dispatched in background (id: ${handle.sessionId}).\nYou'll be notified when it completes. User can /attach ${handle.sessionId} to watch.`,
			{ sessionId: handle.sessionId, status: "running" },
		);
	}
	if (mode === "dispatch") {
		return toolResult(
			`Session dispatched (id: ${handle.sessionId}).\nYou'll be notified when it completes.\nYou can still query with interactive_shell({ sessionId: "${handle.sessionId}" }) if needed.`,
			{ sessionId: handle.sessionId, status: "running" },
		);
	}
	// hands-free
	return toolResult(
		`Session started: ${handle.sessionId}\nCommand: ${params.command ?? "(spawn)"}\n\nUse interactive_shell({ sessionId: "${handle.sessionId}" }) to check status/output.\nUse interactive_shell({ sessionId: "${handle.sessionId}", kill: true }) to end when done.`,
		{ sessionId: handle.sessionId, status: "running" },
	);
}

function handleExistingSession(rt: ShellRuntime, sessionId: string, params: ToolParams): AgentToolResult<unknown> {
	const session = rt.registry.get(sessionId);
	if (!session) {
		return toolResult(`No active session with id '${sessionId}'.`);
	}
	const record = findBySessionId(sessionId);

	if (params.kill) {
		const handle = rt.api.get(sessionId);
		handle?.kill("agent_kill");
		return toolResult(`Session ${sessionId} killed.`);
	}

	if (params.background) {
		return toolResult(`Session ${sessionId} is running headless/in background already, or backgrounding is only available from an open interactive overlay.`);
	}

	const hasStructuredInput = Boolean(params.inputKeys?.length || params.inputHex?.length || params.inputPaste);
	const effectiveInput = hasStructuredInput
		? { text: params.input, keys: params.inputKeys, hex: params.inputHex, paste: params.inputPaste }
		: params.input;

	if (effectiveInput !== undefined || params.submit) {
		const translated = translateInput((effectiveInput ?? "") as never);
		const finalInput = params.submit ? `${translated}\r` : translated;
		session.runtime.write(finalInput);
		return toolResult(`Session ${sessionId}: input sent.`);
	}

	// pure status/output query
	if (record && record.status !== "running") {
		const tail = session.runtime.getTailLines({
			lines: params.outputLines ?? 20,
			ansi: false,
			maxChars: params.outputMaxChars ?? 5 * 1024,
		});
		rt.registry.remove(sessionId);
		return toolResult(
			`Session ${sessionId} ${record.status}.\n\nOutput (${tail.lines.length} lines):\n\n${tail.lines.join("\n")}`,
			{ sessionId, status: record.status, exitCode: record.exitCode, signal: record.signal },
		);
	}

	if (params.drain) {
		const out = session.runtime.getRawStream({ sinceLast: true, stripAnsi: true });
		return toolResult(out.length > 0 ? out : "(no new output)", { sessionId, status: "running" });
	}

	const tail = session.runtime.getTailLines({
		lines: params.outputLines ?? 20,
		ansi: false,
		maxChars: params.outputMaxChars ?? 5 * 1024,
	});
	return toolResult(
		`Session ${sessionId} running (${formatDuration(Date.now() - session.startedAt.getTime())}).\n\nOutput (${tail.lines.length} lines):\n\n${tail.lines.join("\n")}`,
		{ sessionId, status: "running" },
	);
}

async function handleAttach(
	rt: ShellRuntime,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	sessionId: string,
	mode: SupervisionMode,
): Promise<AgentToolResult<unknown>> {
	if (!ctx.hasUI) return toolResult("Attach requires an interactive UI.");
	if (rt.coordinator.isOverlayOpen()) return toolResult("An overlay is already open.");
	const attached = await rt.api.attach(sessionId);
	if (!attached) return toolResult(`No background session with id '${sessionId}'.`);

	if (mode !== "interactive") {
		return toolResult(`Reattached to ${sessionId} in ${mode} mode.`, { sessionId, status: "running" });
	}

	const session = rt.registry.get(sessionId);
	if (!session) return toolResult(`No background session with id '${sessionId}'.`);
	const config = rt.configFor(session.runtime ? ctx.cwd : ctx.cwd);
	const outcome = await openOverlay(pi, ctx, session, rt.coordinator, config).catch(() => "exited" as const);
	return toolResult(`Session ${sessionId}: ${outcome}.`, { sessionId, outcome });
}

function handleListBackground(rt: ShellRuntime): AgentToolResult<unknown> {
	const sessions = rt.registry.list();
	if (sessions.length === 0) return toolResult("No background sessions.");
	const lines = sessions.map((s) => {
		const monitor = rt.coordinator.getMonitorSessionState(s.sessionId);
		const status = monitor ? `monitor:${monitor.strategy} events=${monitor.eventCount}` : s.runtime.exited ? "exited" : "running";
		return `${s.sessionId}  ${s.command}${s.reason ? ` (${s.reason})` : ""}  [${status}]`;
	});
	return toolResult(lines.join("\n"), { sessions: sessions.map((s) => s.sessionId) });
}

async function handleDismissBackground(rt: ShellRuntime, target: boolean | string): Promise<AgentToolResult<unknown>> {
	const sessions = rt.registry.list();
	const targets = target === true ? sessions.map((s) => s.sessionId) : typeof target === "string" ? [target] : [];
	for (const id of targets) {
		rt.coordinator.disposeMonitor(id);
		rt.coordinator.clearMonitorEvents(id);
		rt.registry.remove(id);
		// Clean up the persisted run record so it doesn't linger in the widget
		const record = findBySessionId(id);
		if (record) {
			await deleteRunRecord(record.recordId, record.launchToken);
		}
	}
	return toolResult(`Dismissed ${targets.length} session(s).`, { dismissed: targets });
}

// --- /spawn /attach /dismiss commands ---

export async function handleSpawnCommand(rt: ShellRuntime, _pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const parsed = parseSpawnArgs(args);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.error, "error");
		return;
	}
	const mode: SupervisionMode = parsed.parsed.monitorMode ?? "interactive";
	const { recordId, launchToken } = newRecordIds();
	try {
		const handle = await rt.api.dispatch(ctx, {
			recordId,
			launchToken,
			spawn: parsed.parsed.request,
			mode,
		});
		if (mode === "interactive") {
			await handle.settled;
		} else {
			ctx.ui.notify(`Session dispatched (id: ${handle.sessionId}).`, "info");
		}
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

export async function handleAttachCommand(rt: ShellRuntime, pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (rt.coordinator.isOverlayOpen()) {
		ctx.ui.notify("An overlay is already open.", "error");
		return;
	}
	const sessions = rt.registry.list();
	if (sessions.length === 0) {
		ctx.ui.notify("No background sessions.", "info");
		return;
	}
	let targetId = args.trim();
	if (!targetId) {
		const items = sessions.map((s) => `${s.sessionId} — ${s.command}${s.reason ? ` (${s.reason})` : ""}`);
		const picked = await ctx.ui.select("Attach to session", items);
		if (!picked) return;
		targetId = picked.split(" — ")[0] ?? "";
	}
	const attached = await rt.api.attach(targetId);
	if (!attached) {
		ctx.ui.notify(`No background session with id '${targetId}'.`, "error");
		return;
	}
	const session = rt.registry.get(targetId);
	if (!session) {
		ctx.ui.notify(`No background session with id '${targetId}'.`, "error");
		return;
	}
	const config = rt.configFor(ctx.cwd);
	await openOverlay(pi, ctx, session, rt.coordinator, config).catch((error: unknown) => {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	});
}

export async function handleDismissCommand(rt: ShellRuntime, _pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const sessions = rt.registry.list();
	if (sessions.length === 0) {
		ctx.ui.notify("No background sessions.", "info");
		return;
	}
	const trimmed = args.trim();
	let targetIds: string[];
	if (trimmed) {
		if (!sessions.some((s) => s.sessionId === trimmed)) {
			ctx.ui.notify(`No background session with id '${trimmed}'.`, "error");
			return;
		}
		targetIds = [trimmed];
	} else if (sessions.length === 1) {
		targetIds = [sessions[0]!.sessionId];
	} else {
		const items = ["All sessions", ...sessions.map((s) => s.sessionId)];
		const picked = await ctx.ui.select("Dismiss session", items);
		if (!picked) return;
		targetIds = picked === "All sessions" ? sessions.map((s) => s.sessionId) : [picked];
	}
	for (const id of targetIds) {
		rt.coordinator.disposeMonitor(id);
		rt.coordinator.clearMonitorEvents(id);
		rt.registry.remove(id);
		const record = findBySessionId(id);
		if (record) {
			await deleteRunRecord(record.recordId, record.launchToken);
		}
	}
	ctx.ui.notify(`Dismissed ${targetIds.length} session(s).`, "info");
}
