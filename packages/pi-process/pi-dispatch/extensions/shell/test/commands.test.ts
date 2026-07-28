import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleToolExecute } from "../commands";
import type { ShellRuntime, ShellApi } from "../commands";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DispatchHandle, LiveSession, SessionSummary } from "../types";

// --- Test helpers ---

function makeMockApi(overrides: Partial<ShellApi> = {}): ShellApi {
  return {
    dispatch: vi.fn(),
    attach: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(),
    ...overrides,
  };
}

function makeMockCoordinator(overrides: Record<string, unknown> = {}) {
  return {
    isOverlayOpen: vi.fn(() => false),
    disposeMonitor: vi.fn(),
    clearMonitorEvents: vi.fn(),
    disposeAllMonitors: vi.fn(),
    getMonitorSessionState: vi.fn(),
    consumeAgentHandled: vi.fn(() => false),
    ...overrides,
  };
}

function makeMockRegistry(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(),
    list: vi.fn(() => []),
    add: vi.fn(),
    remove: vi.fn(),
    markExited: vi.fn(),
    killAll: vi.fn(),
    ...overrides,
  };
}

function makeMockCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/fake/cwd",
    hasUI: true,
    sessionManager: { getSessionFile: vi.fn() },
    ...overrides,
  } as unknown as ExtensionContext;
}

function makeMockPi(): ExtensionAPI {
  return {
    sendMessage: vi.fn(),
  } as unknown as ExtensionAPI;
}

function makeShellRuntime(overrides: Partial<ShellRuntime> = {}): ShellRuntime {
  const coordinator = makeMockCoordinator();
  const registry = makeMockRegistry();
  return {
    api: makeMockApi(),
    registry: registry as unknown as ShellRuntime["registry"],
    coordinator: coordinator as unknown as ShellRuntime["coordinator"],
    configFor: vi.fn(() => ({})),
    shutdown: vi.fn(),
    ...overrides,
  } as unknown as ShellRuntime;
}

function makePtyRuntimeMock() {
  return {
    exited: false,
    exitCode: null as number | null,
    signal: undefined as number | undefined,
    pid: 12345,
    pgid: null,
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getRawStream: vi.fn(() => ""),
    getTailLines: vi.fn(() => ({ lines: ["output"], totalLinesInBuffer: 1, truncatedByChars: false })),
    getViewportLines: vi.fn(() => []),
    getLogSlice: vi.fn(() => ({ slice: "", totalLines: 0, totalChars: 0, sliceLineCount: 0 })),
    addDataListener: vi.fn(() => () => {}),
    addExitListener: vi.fn(() => () => {}),
    setEventHandlers: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    scrollToBottom: vi.fn(),
    isScrolledUp: vi.fn(() => false),
  };
}

describe("handleToolExecute", () => {
  let rt: ShellRuntime;
  let pi: ExtensionAPI;
  let ctx: ExtensionContext;

  beforeEach(() => {
    rt = makeShellRuntime();
    pi = makeMockPi();
    ctx = makeMockCtx();
  });

  describe("validation errors", () => {
    it("rejects spawn with sessionId", async () => {
      const result = await handleToolExecute(rt, pi, { spawn: { agent: "claude" }, sessionId: "sess-1" }, ctx);
      expect(result.details).toEqual({});
      const content = result.content;
      expect(content).toBeDefined();
      expect(content?.[0]?.text).toBe("'spawn' is only valid when starting a new session.");
    });

    it("rejects spawn with attach", async () => {
      const result = await handleToolExecute(rt, pi, { spawn: { agent: "pi" }, attach: "sess-1" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("only valid when starting a new session");
    });

    it("rejects spawn with listBackground", async () => {
      const result = await handleToolExecute(rt, pi, { spawn: { agent: "pi" }, listBackground: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("only valid when starting a new session");
    });

    it("rejects spawn with dismissBackground", async () => {
      const result = await handleToolExecute(rt, pi, { spawn: { agent: "pi" }, dismissBackground: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("only valid when starting a new session");
    });

    it("requires command or spawn", async () => {
      const result = await handleToolExecute(rt, pi, {}, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("One of 'command', 'spawn', 'sessionId', 'attach', 'listBackground', or 'dismissBackground' is required");
    });

    it("rejects background without dispatch or monitor mode", async () => {
      const result = await handleToolExecute(rt, pi, { command: "ls", background: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("background: true requires mode='dispatch' or mode='monitor'");
    });

    it("allows background with dispatch mode", async () => {
      // This would require full dispatch to work, but we just verify no validation error
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-dispatch",
          settled: Promise.resolve({ status: "completed", sessionId: "sess-dispatch", exitCode: 0, cancelled: false }),
        })),
      });
      rt.api = mockApi;
      const result = await handleToolExecute(rt, pi, { command: "ls", background: true, mode: "dispatch" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Session dispatched in background");
    });

    it("rejects interactive mode without UI", async () => {
      const noUiCtx = makeMockCtx({ hasUI: false });
      const result = await handleToolExecute(rt, pi, { command: "ls", mode: "interactive" }, noUiCtx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("requires an interactive UI");
    });

    it("rejects hands-free mode without UI", async () => {
      const noUiCtx = makeMockCtx({ hasUI: false });
      const result = await handleToolExecute(rt, pi, { command: "ls", mode: "hands-free" }, noUiCtx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("requires an interactive UI");
    });

    it("allows dispatch mode without UI", async () => {
      const noUiCtx = makeMockCtx({ hasUI: false });
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-disp",
          settled: Promise.resolve({ status: "completed", sessionId: "sess-disp", exitCode: 0, cancelled: false }),
        })),
      });
      rt.api = mockApi;
      const result = await handleToolExecute(rt, pi, { command: "ls", mode: "dispatch" }, noUiCtx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Session dispatched");
    });

    it("rejects interactive mode when overlay is open", async () => {
      const coord = makeMockCoordinator({ isOverlayOpen: vi.fn(() => true) });
      rt.coordinator = coord as unknown as ShellRuntime["coordinator"];
      const result = await handleToolExecute(rt, pi, { command: "ls", mode: "interactive" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("An overlay is already open");
    });

    it("rejects monitor mode without triggers", async () => {
      const result = await handleToolExecute(rt, pi, { command: "sleep 1", mode: "monitor" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("mode='monitor' requires monitor.triggers");
    });

    it("rejects monitor mode with empty triggers", async () => {
      const result = await handleToolExecute(rt, pi, {
        command: "sleep 1",
        mode: "monitor",
        monitor: { triggers: [] },
      }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("mode='monitor' requires monitor.triggers");
    });
  });

  describe("handleExistingSession", () => {
    it("returns error for unknown sessionId", async () => {
      rt.registry.get = vi.fn(() => undefined);
      const result = await handleToolExecute(rt, pi, { sessionId: "nonexistent" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("No active session");
    });

    it("kills an existing session", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: makePtyRuntimeMock(),
      };
      rt.registry.get = vi.fn(() => mockSession);
      rt.api.get = vi.fn(() => ({
        kill: vi.fn(),
      }) as unknown as DispatchHandle);

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1", kill: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("killed");
    });

    it("rejects background flag for existing session", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: makePtyRuntimeMock(),
      };
      rt.registry.get = vi.fn(() => mockSession);

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1", background: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("background");
    });

    it("reports session status for running session", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: {
          ...makePtyRuntimeMock(),
          exited: false,
          getTailLines: vi.fn(() => ({ lines: ["line1", "line2"], totalLinesInBuffer: 2, truncatedByChars: false })),
        },
        startedAt: new Date(Date.now() - 60000),
        command: "npm test",
      };
      rt.registry.get = vi.fn(() => mockSession);

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("running");
    });

    it("reports completed session status", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: {
          ...makePtyRuntimeMock(),
          exited: true,
        },
      };
      rt.registry.get = vi.fn(() => mockSession);

      // Import state module to mock findBySessionId
      const state = await import("../state");
      const origFind = state.findBySessionId;
      vi.spyOn(state, "findBySessionId").mockReturnValue({
        status: "completed",
        exitCode: 0,
        signal: null,
        schemaVersion: 1 as const,
        recordId: "r1",
        launchToken: "t1",
        command: "ls",
        execCommand: "ls",
        cwd: "/tmp",
        worktree: false,
        worktreePolicy: "keep" as const,
        supervision: "dispatch" as const,
        completionContract: "exit-code" as const,
        sessionId: "sess-1",
        ptyPid: 123,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("completed");

      vi.spyOn(state, "findBySessionId").mockRestore();
    });

    it("handles drain query", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: {
          ...makePtyRuntimeMock(),
          exited: false,
          getRawStream: vi.fn(() => "new output"),
        },
      };
      rt.registry.get = vi.fn(() => mockSession);

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1", drain: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toBe("new output");
    });

    it("handles drain with no new output", async () => {
      const mockSession = {
        sessionId: "sess-1",
        runtime: {
          ...makePtyRuntimeMock(),
          exited: false,
          getRawStream: vi.fn(() => ""),
        },
      };
      rt.registry.get = vi.fn(() => mockSession);

      const result = await handleToolExecute(rt, pi, { sessionId: "sess-1", drain: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("no new output");
    });
  });

  describe("handleListBackground", () => {
    it("returns empty message when no sessions", async () => {
      rt.registry.list = vi.fn(() => []);
      const result = await handleToolExecute(rt, pi, { listBackground: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("No background sessions");
    });

    it("lists active sessions", async () => {
      const sessions = [
        {
          sessionId: "sess-1",
          command: "npm test",
          reason: "testing",
          runtime: { exited: false },
          startedAt: new Date(),
        },
      ];
      rt.registry.list = vi.fn(() => sessions as unknown as LiveSession[]);
      const result = await handleToolExecute(rt, pi, { listBackground: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("sess-1");
      expect(text).toContain("npm test");
    });
  });

  describe("handleDismissBackground", () => {
    it("dismisses a specific session", async () => {
      const sessions = [{ sessionId: "sess-1" }, { sessionId: "sess-2" }];
      rt.registry.list = vi.fn(() => sessions as unknown as LiveSession[]);
      rt.registry.remove = vi.fn();

      const result = await handleToolExecute(rt, pi, { dismissBackground: "sess-1" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Dismissed 1 session");
      expect(rt.registry.remove).toHaveBeenCalledWith("sess-1");
    });

    it("dismisses all sessions when true", async () => {
      const sessions = [{ sessionId: "sess-1" }, { sessionId: "sess-2" }];
      rt.registry.list = vi.fn(() => sessions as unknown as LiveSession[]);
      rt.registry.remove = vi.fn();

      const result = await handleToolExecute(rt, pi, { dismissBackground: true }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Dismissed 2 session");
      expect(rt.registry.remove).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleAttach (validation path)", () => {
    it("rejects attach without UI", async () => {
      const noUiCtx = makeMockCtx({ hasUI: false });
      const result = await handleToolExecute(rt, pi, { attach: "sess-1" }, noUiCtx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("requires an interactive UI");
    });

    it("rejects attach when overlay is open", async () => {
      const coord = makeMockCoordinator({ isOverlayOpen: vi.fn(() => true) });
      rt.coordinator = coord as unknown as ShellRuntime["coordinator"];
      const result = await handleToolExecute(rt, pi, { attach: "sess-1" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("overlay is already open");
    });

    it("rejects attach for nonexistent session", async () => {
      rt.api.attach = vi.fn(async () => undefined);
      const result = await handleToolExecute(rt, pi, { attach: "nonexistent" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("No background session");
    });
  });

  describe("successful dispatch", () => {
    it("returns dispatch result for interactive mode completion", async () => {
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-ok",
          settled: Promise.resolve({ status: "completed", sessionId: "sess-ok", exitCode: 0, cancelled: false }),
        })),
      });
      rt.api = mockApi;

      const result = await handleToolExecute(rt, pi, { command: "echo hi", mode: "interactive" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toBe("Session ended successfully");
    });

    it("returns dispatch result for monitor mode", async () => {
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-mon",
          settled: Promise.resolve({ status: "completed", sessionId: "sess-mon", exitCode: 0, cancelled: false }),
        })),
      });
      rt.api = mockApi;

      const result = await handleToolExecute(rt, pi, {
        command: "npm test",
        mode: "monitor",
        monitor: { triggers: [{ id: "fail", literal: "FAIL" }] },
      }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Monitor started in background");
      expect(text).toContain("fail");
    });

    it("returns dispatch result for hands-free mode", async () => {
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-hf",
          settled: Promise.resolve({ status: "completed", sessionId: "sess-hf", exitCode: 0, cancelled: false }),
        })),
      });
      rt.api = mockApi;

      const result = await handleToolExecute(rt, pi, { command: "npm run build", mode: "hands-free" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Session started:");
      expect(text).toContain("sess-hf");
    });

    it("handles dispatch error gracefully", async () => {
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => {
          throw new Error("PTY spawn failed");
        }),
      });
      rt.api = mockApi;

      const result = await handleToolExecute(rt, pi, { command: "nonexistent", mode: "dispatch" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toBe("PTY spawn failed");
    });

    it("reports failed interactive session", async () => {
      const mockApi = makeMockApi({
        dispatch: vi.fn(async () => ({
          sessionId: "sess-fail",
          settled: Promise.resolve({ status: "failed", sessionId: "sess-fail", exitCode: 1, cancelled: false }),
        })),
      });
      rt.api = mockApi;

      const result = await handleToolExecute(rt, pi, { command: "false", mode: "interactive" }, ctx);
      const text = result.content?.[0]?.text;
      expect(text).toContain("Session ended (failed)");
    });
  });
});
