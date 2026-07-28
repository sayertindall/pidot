import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks via vi.hoisted() so vitest's transform can access them.
// ---------------------------------------------------------------------------

const {
	mockCreateAgentSession,
	mockGetAgentDir,
	mockSessionManagerCreate,
	mockSessionManagerInMemory,
	mockSettingsManagerCreate,
} = vi.hoisted(() => ({
	mockCreateAgentSession: vi.fn(),
	mockGetAgentDir: vi.fn(() => "/mock/agent/dir"),
	mockSessionManagerCreate: vi.fn(),
	mockSessionManagerInMemory: vi.fn(),
	mockSettingsManagerCreate: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: mockCreateAgentSession,
	getAgentDir: mockGetAgentDir,
	DefaultResourceLoader: class {
		constructor(_opts: unknown) {}
		async reload() {}
	},
	SessionManager: {
		create: (...args: unknown[]) => mockSessionManagerCreate(...args),
		inMemory: (...args: unknown[]) => mockSessionManagerInMemory(...args),
	},
	SettingsManager: {
		create: (...args: unknown[]) => mockSettingsManagerCreate(...args),
	},
}));

vi.mock("../extensions/subagents/discovery.ts", () => ({
	installExtensionToolScope: vi.fn(),
	BUILTIN_TOOL_NAMES: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	parseExtSelectors: vi.fn(() => ({ extNames: new Set(), narrowing: new Map() })),
}));

vi.mock("../extensions/subagents/types.ts", async () => {
	const actual = await vi.importActual("../extensions/subagents/types.ts");
	return {
		...actual,
		EXCLUDED_TOOL_NAMES: ["Agent", "get_subagent_result", "steer_subagent"],
		SUBAGENT_TOOL_NAMES: {
			AGENT: "Agent",
			GET_RESULT: "get_subagent_result",
			STEER: "steer_subagent",
		},
	};
});

import {
	getGraceTurns,
	setGraceTurns,
	getDefaultMaxTurns,
	setDefaultMaxTurns,
	normalizeMaxTurns,
	runAgent,
	resumeAgent,
} from "../extensions/subagents/session-runner.ts";
import type { AgentConfig, SubagentType, ThinkingLevel } from "../extensions/subagents/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockMessage {
	role: string;
	content: unknown;
	stopReason?: string;
	errorMessage?: string;
	usage?: Record<string, number>;
}

interface MockSessionOverrides {
	promptBehavior?: "resolve" | "addMessages" | "controlled";
	/** Messages to push when prompt is called (for "addMessages" behavior). */
	pushMessages?: MockMessage[];
	/** Messages to fire events for (text deltas). */
	eventMessages?: Array<{ role: string; deltas?: string[] }>;
	/** Pre-populated messages array. */
	messages?: MockMessage[];
	/** Fire turn_end events. */
	turns?: number;
	/** Fire tool events. */
	tools?: Array<{ toolName: string }>;
	/** Fire compaction event. */
	compaction?: { aborted: boolean; reason: string; result?: { tokensBefore: number } | null };
	/** Fire usage data on message_end. */
	usageData?: { input?: number; output?: number; cacheWrite?: number };
}

function mockSession(overrides: MockSessionOverrides = {}) {
	const subs: Array<(event: Record<string, unknown>) => void> = [];
	const messages: MockMessage[] = overrides.messages ? [...overrides.messages] : [];

	let promptResolve: (() => void) | null = null;

	const session = {
		subscribe: vi.fn((fn: (event: Record<string, unknown>) => void) => {
			subs.push(fn);
			return () => {
				const idx = subs.indexOf(fn);
				if (idx >= 0) subs.splice(idx, 1);
			};
		}),
		setSessionName: vi.fn(),
		bindExtensions: vi.fn().mockResolvedValue(undefined),
		prompt: vi.fn().mockImplementation(async () => {
			if (overrides.promptBehavior === "controlled") {
				return new Promise<void>((resolve) => {
					promptResolve = resolve;
				});
			}

			if (overrides.pushMessages) {
				for (const m of overrides.pushMessages) {
					messages.push(m);
				}
			}

			// Fire event-driven messages
			if (overrides.eventMessages) {
				for (const em of overrides.eventMessages) {
					session._fire({ type: "message_start", message: { role: em.role, content: "" } });
					if (em.deltas) {
						for (const delta of em.deltas) {
							session._fire({
								type: "message_update",
								assistantMessageEvent: { type: "text_delta", delta },
							});
						}
					}
				}
			}

			if (overrides.turns) {
				for (let i = 0; i < overrides.turns; i++) {
					session._fire({ type: "turn_end" });
				}
			}

			if (overrides.tools) {
				for (const t of overrides.tools) {
					session._fire({ type: "tool_execution_start", toolName: t.toolName });
					session._fire({ type: "tool_execution_end", toolName: t.toolName });
				}
			}

			if (overrides.compaction) {
				session._fire({
					type: "compaction_end",
					aborted: overrides.compaction.aborted,
					reason: overrides.compaction.reason,
					result: overrides.compaction.result ?? undefined,
				});
			}

			if (overrides.usageData) {
				session._fire({
					type: "message_end",
					message: { role: "assistant", usage: overrides.usageData },
				});
			}
		}),
		abort: vi.fn(),
		steer: vi.fn(),
		messages,
		getAllTools: vi.fn(() => []),
		getActiveToolNames: vi.fn(() => []),
		setActiveToolsByName: vi.fn(),
		agent: {
			beforeToolCall: undefined as unknown,
		},
		_fire: (event: Record<string, unknown>) => subs.forEach((fn) => fn(event)),
		// For controlled prompt resolution in abort tests
		_resolvePrompt: () => {
			if (promptResolve) {
				promptResolve();
				promptResolve = null;
			}
		},
	};

	return session;
}

function mockExtensionContext(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		cwd: "/project",
		model: undefined,
		modelRegistry: {} as unknown,
		getSystemPrompt: vi.fn().mockReturnValue("parent system prompt"),
		...overrides,
	};
}

function defaultAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "A test agent",
		extensions: true,
		skills: true,
		systemPrompt: "You are a test agent.",
		promptMode: "replace",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests: grace turns & max turns setters
// ---------------------------------------------------------------------------

describe("grace turns", () => {
	it("starts at 5", () => {
		expect(getGraceTurns()).toBe(5);
	});

	it("setGraceTurns updates and clamps to a minimum of 1", () => {
		setGraceTurns(10);
		expect(getGraceTurns()).toBe(10);
		setGraceTurns(0);
		expect(getGraceTurns()).toBe(1);
		setGraceTurns(-3);
		expect(getGraceTurns()).toBe(1);
	});

	afterEach(() => setGraceTurns(5));
});

describe("default max turns", () => {
	it("starts undefined", () => {
		expect(getDefaultMaxTurns()).toBeUndefined();
	});

	it("setDefaultMaxTurns(0) stores undefined (unlimited)", () => {
		setDefaultMaxTurns(0);
		expect(getDefaultMaxTurns()).toBeUndefined();
	});

	it("setDefaultMaxTurns(null | undefined) stores undefined", () => {
		setDefaultMaxTurns(undefined);
		expect(getDefaultMaxTurns()).toBeUndefined();
		setDefaultMaxTurns(null as unknown as number);
		expect(getDefaultMaxTurns()).toBeUndefined();
	});

	it("setDefaultMaxTurns(3) stores 3", () => {
		setDefaultMaxTurns(3);
		expect(getDefaultMaxTurns()).toBe(3);
	});

	afterEach(() => setDefaultMaxTurns(undefined));
});

describe("normalizeMaxTurns", () => {
	it("returns undefined for null/0/undefined", () => {
		expect(normalizeMaxTurns(null as unknown as number)).toBeUndefined();
		expect(normalizeMaxTurns(0)).toBeUndefined();
		expect(normalizeMaxTurns(undefined)).toBeUndefined();
	});

	it("returns n for n >= 1", () => {
		expect(normalizeMaxTurns(1)).toBe(1);
		expect(normalizeMaxTurns(42)).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// Tests: runAgent
// ---------------------------------------------------------------------------

describe("runAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setGraceTurns(5);
		setDefaultMaxTurns(undefined);
	});

	// ---- happy path ----

	it("creates a session, sends a prompt, and returns the collected response text", async () => {
		const session = mockSession({
			eventMessages: [{ role: "assistant", deltas: ["Hello ", "world!"] }],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();
		const result = await runAgent(ctx, "general-purpose", "Say hello", { agentConfig: config });

		expect(mockCreateAgentSession).toHaveBeenCalledOnce();
		expect(session.setSessionName).toHaveBeenCalledWith("test-agent");
		expect(session.bindExtensions).toHaveBeenCalledOnce();
		expect(session.prompt).toHaveBeenCalledWith("Say hello");
		expect(result.responseText).toBe("Hello world!");
		expect(result.aborted).toBe(false);
		expect(result.failure).toBeUndefined();
	});

	it("appends parent system prompt when promptMode is 'append'", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig({ promptMode: "append", systemPrompt: "child system prompt" });
		const result = await runAgent(ctx, "general-purpose", "Say hello", { agentConfig: config });
		expect(result.failure).toBeUndefined();
	});

	it("uses agentId to decorate the session name", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();
		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, agentId: "abc123456789" });

		expect(session.setSessionName).toHaveBeenCalledWith("test-agent#abc12345");
	});

	it("uses the type name as the session name when agentConfig.name is empty", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		// Use undefined name, which falls through to ?? type
		const config = defaultAgentConfig();
		(config as Record<string, unknown>).name = undefined;

		await runAgent(ctx, "Explore" as SubagentType, "hi", { agentConfig: config });

		expect(session.setSessionName).toHaveBeenCalledWith("Explore");
	});

	it("calls onSessionCreated with the session", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const onSessionCreated = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onSessionCreated });
		expect(onSessionCreated).toHaveBeenCalledWith(session);
	});

	it("calls onTextDelta for each text delta event", async () => {
		const session = mockSession({
			eventMessages: [{ role: "assistant", deltas: ["A", "B"] }],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onTextDelta = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onTextDelta });
		expect(onTextDelta).toHaveBeenCalledTimes(2);
		expect(onTextDelta).toHaveBeenNthCalledWith(1, "A", "A");
		expect(onTextDelta).toHaveBeenNthCalledWith(2, "B", "AB");
	});

	it("calls onToolActivity for tool start/end events", async () => {
		const session = mockSession({
			tools: [{ toolName: "read" }],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onToolActivity = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onToolActivity });
		expect(onToolActivity).toHaveBeenCalledTimes(2);
		expect(onToolActivity).toHaveBeenNthCalledWith(1, { type: "start", toolName: "read" });
		expect(onToolActivity).toHaveBeenNthCalledWith(2, { type: "end", toolName: "read" });
	});

	it("calls onTurnEnd after each turn", async () => {
		const session = mockSession({ turns: 2 });
		mockCreateAgentSession.mockResolvedValue({ session });

		const onTurnEnd = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onTurnEnd });
		expect(onTurnEnd).toHaveBeenCalledTimes(2);
		expect(onTurnEnd).toHaveBeenNthCalledWith(1, 1);
		expect(onTurnEnd).toHaveBeenNthCalledWith(2, 2);
	});

	it("calls onAssistantUsage on message_end with usage data", async () => {
		const session = mockSession({
			usageData: { input: 100, output: 50, cacheWrite: 10 },
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onAssistantUsage = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onAssistantUsage });
		expect(onAssistantUsage).toHaveBeenCalledWith({ input: 100, output: 50, cacheWrite: 10 });
	});

	it("handles missing usage fields gracefully (defaults to 0)", async () => {
		const session = mockSession({
			usageData: {},
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onAssistantUsage = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onAssistantUsage });
		expect(onAssistantUsage).toHaveBeenCalledWith({ input: 0, output: 0, cacheWrite: 0 });
	});

	it("calls onCompaction on compaction_end with success", async () => {
		const session = mockSession({
			compaction: { aborted: false, reason: "threshold", result: { tokensBefore: 5000 } },
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onCompaction = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onCompaction });
		expect(onCompaction).toHaveBeenCalledWith({ reason: "threshold", tokensBefore: 5000 });
	});

	it("does NOT call onCompaction when compaction was aborted or has no result", async () => {
		const session = mockSession({
			compaction: { aborted: true, reason: "overflow" },
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const onCompaction = vi.fn();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, onCompaction });
		expect(onCompaction).not.toHaveBeenCalled();
	});

	// ---- turn limits ----

	it("steers the session when the soft turn limit is reached", async () => {
		const session = mockSession({ turns: 1 });
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, maxTurns: 1 });
		expect(result.steered).toBe(true);
		expect(session.steer).toHaveBeenCalledWith(
			"You have reached your turn limit. Wrap up immediately — provide your final answer now.",
		);
	});

	it("aborts the session when turns exceed maxTurns + graceTurns", async () => {
		const session = mockSession({ turns: 6 });
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, maxTurns: 1 });
		expect(result.aborted).toBe(true);
		expect(result.steered).toBe(true);
		expect(session.abort).toHaveBeenCalled();
	});

	it("uses agentConfig.maxTurns when options.maxTurns is not provided", async () => {
		const session = mockSession({ turns: 1 });
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig({ maxTurns: 2 });

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.steered).toBe(false); // only 1 turn, below limit
	});

	it("uses global defaultMaxTurns when neither options nor agentConfig specify it", async () => {
		setDefaultMaxTurns(1);
		const session = mockSession({ turns: 1 });
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.steered).toBe(true);
	});

	// ---- abort signal ----

	it("aborts the session when the AbortSignal fires during prompt", async () => {
		const session = mockSession({ promptBehavior: "controlled" });
		mockCreateAgentSession.mockResolvedValue({ session });

		const controller = new AbortController();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const runPromise = runAgent(ctx, "general-purpose", "hi", {
			agentConfig: config,
			signal: controller.signal,
		});

		// Give the event loop a tick to start prompt
		await new Promise((r) => setTimeout(r, 0));
		controller.abort();
		// Now resolve prompt so it can finish
		session._resolvePrompt();

		await runPromise;
		expect(session.abort).toHaveBeenCalled();
	});

	it("cleans up the abort listener after prompt completes", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const controller = new AbortController();
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", {
			agentConfig: config,
			signal: controller.signal,
		});

		controller.abort();
		expect(session.abort).not.toHaveBeenCalled();
	});

	// ---- error / failure cases ----

	it("detects a provider error on the final assistant message", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: "", stopReason: "error", errorMessage: "Provider API error" },
			],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.failure).toBe("Provider API error");
	});

	it("detects a length stop with no text as failure", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: "", stopReason: "length" },
			],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.failure).toBe("run hit the output token limit before producing any text");
	});

	it("length stop with content is NOT a failure", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: [{ type: "text", text: "Got it" }], stopReason: "length" },
			],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.failure).toBeUndefined();
		// The responseText should come from the pushed message (fallback), not the collector
		expect(result.responseText).toBe("Got it");
	});

	it("returns an empty string and no failure for a non-error normal completion", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: "", stopReason: "end_turn" },
			],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.failure).toBeUndefined();
		expect(result.responseText).toBe("");
	});

	it("falls back to collecting response from messages array when text collector is empty", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: [{ type: "text", text: "  Fallback text  " }] },
			],
		});
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		const result = await runAgent(ctx, "general-purpose", "hi", { agentConfig: config });
		expect(result.responseText).toBe("Fallback text");
	});

	// ---- isolated mode ----

	it("isolated mode disables extensions and clears extSelectors", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig({
			extensions: ["mcp"],
			extSelectors: ["ext:mcp/fetch"],
		});

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, isolated: true });
		expect(session.prompt).toHaveBeenCalled();
	});

	// ---- cwd / configCwd ----

	it("uses options.cwd when provided", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, cwd: "/alt" });

		const callArgs = mockCreateAgentSession.mock.calls[0] as [{ cwd: string }];
		expect(callArgs[0].cwd).toBe("/alt");
	});

	it("uses configCwd for settings and resource loading when provided", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig({ sessionDir: "/custom/session/dir" });

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, cwd: "/work", configCwd: "/config" });

		const callArgs = mockCreateAgentSession.mock.calls[0] as [{ cwd: string }];
		expect(callArgs[0].cwd).toBe("/work");
		expect(mockSettingsManagerCreate).toHaveBeenCalledWith("/config", expect.any(String));
	});

	// ---- inheritContext ----

	it("prepends parentContextBlock when inheritContext is set", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", {
			agentConfig: config,
			inheritContext: true,
			parentContextBlock: "[PARENT CONTEXT]\n",
		});

		expect(session.prompt).toHaveBeenCalledWith("[PARENT CONTEXT]\nhi");
	});

	it("does not prepend parentContextBlock when inheritContext is falsy", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", {
			agentConfig: config,
			parentContextBlock: "[PARENT CONTEXT]\n",
		});

		expect(session.prompt).toHaveBeenCalledWith("hi");
	});

	// ---- model resolution ----

	it("uses the explicit options.model over config and parent", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const explicitModel = { provider: "test", modelId: "explicit" };
		const ctx = mockExtensionContext();
		const config = defaultAgentConfig({ model: "anthropic/claude-sonnet-4" });

		await runAgent(ctx, "general-purpose", "hi", { agentConfig: config, model: explicitModel as never });

		const callArgs = mockCreateAgentSession.mock.calls[0] as [{ model: unknown }];
		expect(callArgs[0].model).toBe(explicitModel);
	});

	// ---- thinking level ----

	it("passes thinkingLevel through to createAgentSession", async () => {
		const session = mockSession();
		mockCreateAgentSession.mockResolvedValue({ session });

		const ctx = mockExtensionContext();
		const config = defaultAgentConfig();

		await runAgent(ctx, "general-purpose", "hi", {
			agentConfig: config,
			thinkingLevel: "high" as ThinkingLevel,
		});

		const callArgs = mockCreateAgentSession.mock.calls[0] as [{ thinkingLevel: string }];
		expect(callArgs[0].thinkingLevel).toBe("high");
	});
});

// ---------------------------------------------------------------------------
// Tests: resumeAgent
// ---------------------------------------------------------------------------

describe("resumeAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sends a follow-up prompt to an existing session and returns the text", async () => {
		const session = mockSession({
			eventMessages: [{ role: "assistant", deltas: ["Follow-up response"] }],
		});

		const result = await resumeAgent(session as never, "Continue...");
		expect(result.text).toBe("Follow-up response");
		expect(result.failure).toBeUndefined();
		expect(session.prompt).toHaveBeenCalledWith("Continue...");
	});

	it("detects a provider error on the last assistant message", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: "", stopReason: "error", errorMessage: "Resume error" },
			],
		});

		const result = await resumeAgent(session as never, "Continue...");
		expect(result.failure).toBe("Resume error");
	});

	it("forwards tool activity callbacks", async () => {
		const session = mockSession({
			tools: [{ toolName: "bash" }],
		});

		const onToolActivity = vi.fn();
		await resumeAgent(session as never, "Run a command", { onToolActivity });
		expect(onToolActivity).toHaveBeenCalledWith({ type: "start", toolName: "bash" });
	});

	it("aborts the session when the signal fires during prompt", async () => {
		const session = mockSession({ promptBehavior: "controlled" });
		const controller = new AbortController();

		const runPromise = resumeAgent(session as never, "hi", {
			signal: controller.signal,
		});

		await new Promise((r) => setTimeout(r, 0));
		controller.abort();
		session._resolvePrompt();

		await runPromise;
		expect(session.abort).toHaveBeenCalled();
	});

	it("cleans up the abort listener after prompt completes", async () => {
		const session = mockSession();
		const controller = new AbortController();

		await resumeAgent(session as never, "hi", { signal: controller.signal });

		controller.abort();
		expect(session.abort).not.toHaveBeenCalled();
	});

	it("falls back to messages array when text collector is empty", async () => {
		const session = mockSession({
			pushMessages: [
				{ role: "assistant", content: [{ type: "text", text: "  Stored text  " }] },
			],
		});

		const result = await resumeAgent(session as never, "hi");
		expect(result.text).toBe("Stored text");
	});
});
