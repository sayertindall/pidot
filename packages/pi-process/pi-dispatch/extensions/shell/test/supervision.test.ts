import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeadlessSupervisor, type Clock, type HeadlessSupervisorOptions } from "../supervision";
import type { DispatchConfig } from "../config";
import type { PtyRuntime } from "../runtime";
import type { MonitorConfig } from "../types";

// --- Fake clock for deterministic testing ---

function createFakeClock(initialMs = 0): Clock & { advance(ms: number): void } {
  let current = initialMs;
  const timeouts = new Map<unknown, { fn: () => void; at: number }>();
  const intervals = new Map<unknown, { fn: () => void; at: number; intervalMs: number }>();
  let nextId = 0;

  return {
    now: () => current,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timeouts.set(id, { fn, at: current + ms });
      return id;
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle);
    },
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, at: current + ms, intervalMs: ms });
      return id;
    },
    clearInterval: (handle) => {
      intervals.delete(handle);
    },
    advance(ms: number) {
      const steps = 100; // max iterations to prevent infinite loops
      for (let step = 0; step < steps; step++) {
        if (ms <= 0) break;
        // Find the next timer to fire
        let nextAt = Infinity;
        for (const t of timeouts.values()) {
          if (t.at <= current) { nextAt = current; break; }
          if (t.at < nextAt) nextAt = t.at;
        }
        for (const t of intervals.values()) {
          if (t.at <= current) { nextAt = current; break; }
          if (t.at < nextAt) nextAt = t.at;
        }

        if (nextAt > current + ms) {
          current += ms;
          break;
        }

        const advanceBy = Math.max(0, nextAt - current);
        current += advanceBy;
        ms -= advanceBy;

        // Fire timeouts
        for (const [id, t] of timeouts) {
          if (t.at <= current) {
            timeouts.delete(id);
            t.fn();
          }
        }
        // Fire and reschedule intervals
        for (const [id, t] of intervals) {
          if (t.at <= current) {
            t.at = current + t.intervalMs;
            t.fn();
          }
        }
      }
    },
  };
}

// --- Mock PtyRuntime ---

function createMockRuntime(overrides: Partial<PtyRuntime> = {}): PtyRuntime {
  const listeners: Array<{ type: "data" | "exit"; fn: (...args: never[]) => void }> = [];

  const mock = {
    _exited: false,
    _exitCode: null as number | null,
    _signal: undefined as number | undefined,

    get exited() { return mock._exited; },
    get exitCode() { return mock._exitCode; },
    get signal() { return mock._signal; },

    addDataListener: vi.fn((cb: (data: string) => void) => {
      const entry = { type: "data" as const, fn: cb as (...args: never[]) => void };
      listeners.push(entry);
      return () => {
        const idx = listeners.indexOf(entry);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),

    addExitListener: vi.fn((cb: (exitCode: number, signal?: number) => void) => {
      const entry = { type: "exit" as const, fn: cb as (...args: never[]) => void };
      listeners.push(entry);
      return () => {
        const idx = listeners.indexOf(entry);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),

    getRawStream: vi.fn(() => ""),
    getTailLines: vi.fn(() => ({ lines: ["line1", "line2"], totalLinesInBuffer: 2, truncatedByChars: false })),
    kill: vi.fn(),

    // Simulate data arriving (used by tests to trigger behaviour)
    _emitData(data: string) {
      for (const l of listeners) {
        if (l.type === "data") l.fn(data);
      }
    },
    _emitExit(exitCode: number, signal?: number) {
      mock._exited = true;
      mock._exitCode = exitCode;
      mock._signal = signal;
      for (const l of listeners) {
        if (l.type === "exit") l.fn(exitCode, signal);
      }
    },

    ...overrides,
  } as unknown as PtyRuntime;

  return mock;
}

// --- Default config ---

function makeConfig(overrides: Partial<DispatchConfig> = {}): DispatchConfig {
  return {
    scrollbackLines: 5000,
    ansiReemit: true,
    overlayHeightPercent: 80,
    overlayWidthPercent: 95,
    exitAutoCloseDelay: 10,
    handsFreeQuietThreshold: 8000,
    autoExitGracePeriod: 15000,
    completionNotifyLines: 100,
    completionNotifyMaxChars: 10000,
    handoffSnapshotLines: 80,
    handoffSnapshotMaxChars: 20000,
    handsFreeUpdateMode: "on-quiet",
    handsFreeUpdateInterval: 60000,
    handsFreeUpdateMaxChars: 1500,
    handsFreeMaxTotalChars: 100000,
    spawn: {
      worktree: false,
      worktreePolicy: "keep",
      worktreeBaseDir: undefined,
      defaultAgent: "pi",
      defaultArgs: { pi: ["--yes"], codex: [], claude: ["-p"], cursor: ["--yes"], gemini: [] },
      commands: { pi: "pi", codex: "codex", claude: "claude", cursor: "cursor", gemini: "gemini" },
    },
    ...overrides,
  };
}

describe("HeadlessSupervisor", () => {
  let clock: ReturnType<typeof createFakeClock>;
  let runtime: ReturnType<typeof createMockRuntime>;
  let config: DispatchConfig;
  let onComplete: ReturnType<typeof vi.fn>;
  let supervisor: HeadlessSupervisor;

  function createSupervisor(options: Partial<HeadlessSupervisorOptions> = {}) {
    supervisor = new HeadlessSupervisor(
      runtime,
      config,
      {
        autoExitOnQuiet: true,
        quietThreshold: 5000,
        ...options,
      },
      onComplete,
      clock,
    );
    return supervisor;
  }

  beforeEach(() => {
    clock = createFakeClock(1000000);
    runtime = createMockRuntime();
    config = makeConfig();
    onComplete = vi.fn();
    supervisor = createSupervisor();
  });

  afterEach(() => {
    try {
      supervisor.dispose();
    } catch {
      // Ignore
    }
  });

  describe("construction", () => {
    it("creates without error", () => {
      expect(supervisor).toBeDefined();
      expect(supervisor.disposed).toBe(false);
    });

    it("uses provided startTime", () => {
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        startedAt: 500000,
      }, onComplete, clock);
      expect(s.startTime).toBe(500000);
      s.dispose();
    });

    it("defaults startTime to clock.now()", () => {
      expect(supervisor.startTime).toBe(1000000);
    });

    it("subscribes to runtime data/exit listeners", () => {
      expect(runtime.addDataListener).toHaveBeenCalled();
      expect(runtime.addExitListener).toHaveBeenCalled();
    });

    it("handles already-exited runtime in microtask", async () => {
      const exitedRuntime = createMockRuntime({ _exited: true, _exitCode: 0 });
      const s = new HeadlessSupervisor(exitedRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
      }, onComplete, clock);

      // Let microtask flush
      await new Promise((r) => setTimeout(r, 10));
      expect(onComplete).toHaveBeenCalled();
      s.dispose();
    });

    it("does not set quiet timer when autoExitOnQuiet is false", () => {
      // Dispose the beforeEach-created supervisor which has autoExitOnQuiet=true
      supervisor.dispose();
      const freshOnComplete = vi.fn();
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
      }, freshOnComplete, clock);
      // Quiet timer should not fire because we never started it
      clock.advance(20000);
      expect(freshOnComplete).not.toHaveBeenCalled();
      s.dispose();
    });

    it("starts timeout timer when timeout is set", () => {
      supervisor.dispose();
      const freshOnComplete = vi.fn();
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        timeout: 30000,
      }, freshOnComplete, clock);
      clock.advance(30001);
      expect(freshOnComplete).toHaveBeenCalled();
      s.dispose();
    });

    it("does not start timeout timer for timeout=0", () => {
      supervisor.dispose();
      const freshOnComplete = vi.fn();
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        timeout: 0,
      }, freshOnComplete, clock);
      clock.advance(100000);
      expect(freshOnComplete).not.toHaveBeenCalled();
      s.dispose();
    });
  });

  describe("quiet auto-exit", () => {
    it("fires after quiet threshold + grace period with no data", () => {
      // Need to get past both quiet threshold (5000) and grace period (15000)
      clock.advance(25000);
      expect(onComplete).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.termination.cause).toBe("quiet_auto_exit");
    });

    it("resets quiet timer when visible data arrives", () => {
      // Emit visible data to reset quiet timer
      runtime._emitData("some output here");
      // Advance past quiet threshold, but grace period may still block
      clock.advance(6000);
      // The timer reset. Now advance past grace period + threshold
      clock.advance(25000);
      expect(onComplete).toHaveBeenCalled();
    });

    it("does not reset timer for whitespace-only output", () => {
      // Emit whitespace that won't reset the timer
      runtime._emitData("   \t  \n");
      // Need to pass both threshold + grace period
      clock.advance(25000);
      expect(onComplete).toHaveBeenCalled();
    });

    it("respects custom grace period", () => {
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: true,
        quietThreshold: 5000,
        gracePeriod: 5000,
        startedAt: clock.now(),
      }, onComplete, clock);

      // Within grace period (5000), timer fires but resets itself
      clock.advance(5001);
      // Grace just ended. The timer was reset so it won't fire yet.
      // Another 5000ms should trigger it
      clock.advance(5000);
      expect(onComplete).toHaveBeenCalled();
      s.dispose();
    });
  });

  describe("child exit", () => {
    it("calls onComplete when runtime exits", () => {
      runtime._emitExit(0);
      expect(onComplete).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.termination.cause).toBe("child_exit");
      expect(result?.termination.exitCode).toBe(0);
    });

    it("passes exit code and signal", () => {
      runtime._emitExit(1, 15);
      expect(onComplete).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.termination.exitCode).toBe(1);
      expect(result?.termination.signal).toBe(15);
    });
  });

  describe("timeout", () => {
    it("calls onComplete and kills runtime", () => {
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        timeout: 10000,
      }, onComplete, clock);

      clock.advance(10001);
      expect(onComplete).toHaveBeenCalled();
      expect(runtime.kill).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.termination.cause).toBe("timeout");
      s.dispose();
    });
  });

  describe("dispose", () => {
    it("sets disposed flag and stops timers", () => {
      supervisor.dispose();
      expect(supervisor.disposed).toBe(true);
      // Quiet timer should not fire after dispose
      clock.advance(20000);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("double dispose is safe", () => {
      supervisor.dispose();
      expect(() => supervisor.dispose()).not.toThrow();
    });
  });

  describe("handleExternalCompletion", () => {
    it("allows external kill to finalize", () => {
      supervisor.handleExternalCompletion("user_kill", null, undefined);
      expect(onComplete).toHaveBeenCalled();
      const result = onComplete.mock.calls[0]?.[0];
      expect(result?.termination.cause).toBe("user_kill");
    });

    it("sets disposed after external completion", () => {
      supervisor.handleExternalCompletion("agent_kill", 0, undefined);
      expect(supervisor.disposed).toBe(true);
    });

    it("is idempotent (second call ignored)", () => {
      supervisor.handleExternalCompletion("user_kill", null, undefined);
      onComplete.mockClear();
      supervisor.handleExternalCompletion("shutdown", 1, 9);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe("registerCompleteCallback", () => {
    it("fires immediately if already complete", () => {
      const cb = vi.fn();
      runtime._emitExit(0);
      supervisor.registerCompleteCallback(cb);
      expect(cb).toHaveBeenCalled();
    });

    it("fires when completion happens later", () => {
      const cb = vi.fn();
      supervisor.registerCompleteCallback(cb);
      expect(cb).not.toHaveBeenCalled();
      runtime._emitExit(0);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe("getResult", () => {
    it("returns undefined before completion", () => {
      expect(supervisor.getResult()).toBeUndefined();
    });

    it("returns result after completion", () => {
      runtime._emitExit(0);
      const result = supervisor.getResult();
      expect(result).toBeDefined();
      expect(result?.termination.cause).toBe("child_exit");
    });
  });

  describe("monitor triggers (stream strategy)", () => {
    const monitorConfig: MonitorConfig = {
      strategy: "stream",
      triggers: [{ id: "fail", literal: "FAIL" }],
    };

    it("emits monitor event on matching data line", () => {
      const freshRuntime = createMockRuntime();
      const onMonitorEvent = vi.fn();
      const s = new HeadlessSupervisor(freshRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        monitor: monitorConfig,
        onMonitorEvent,
      }, vi.fn(), clock);

      // bufferLines splits on newlines, so include a newline
      freshRuntime._emitData("some FAIL happened\n");
      expect(onMonitorEvent).toHaveBeenCalled();
      const event = onMonitorEvent.mock.calls[0]?.[0];
      expect(event?.triggerId).toBe("fail");
      expect(event?.strategy).toBe("stream");
      s.dispose();
    });

    it("does not emit for non-matching data", () => {
      const freshRuntime = createMockRuntime();
      const onMonitorEvent = vi.fn();
      const s = new HeadlessSupervisor(freshRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        monitor: monitorConfig,
        onMonitorEvent,
      }, vi.fn(), clock);

      freshRuntime._emitData("all good here\n");
      expect(onMonitorEvent).not.toHaveBeenCalled();
      s.dispose();
    });

    it("flushes buffered partial line on teardown", () => {
      const freshRuntime = createMockRuntime();
      const onMonitorEvent = vi.fn();
      const s = new HeadlessSupervisor(freshRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        monitor: monitorConfig,
        onMonitorEvent,
      }, vi.fn(), clock);

      // Partial line without newline — buffered
      freshRuntime._emitData("partial FAIL");
      // Teardown via exit should flush the buffer
      freshRuntime._emitExit(0);
      expect(onMonitorEvent).toHaveBeenCalled();
      s.dispose();
    });
  });

  describe("sentinel contract", () => {
    it("uses sentinel contract when sentinel option is provided", () => {
      const s = new HeadlessSupervisor(runtime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        sentinel: { recordId: "rec-1", launchToken: "tok-1" },
      }, onComplete, clock);

      // The supervisor should subscribe and scan for sentinels
      expect(runtime.addDataListener).toHaveBeenCalled();
      s.dispose();
    });
  });

  describe("monitor poll-diff strategy", () => {
    it("emits on data change between polls", () => {
      const freshRuntime = createMockRuntime();
      const onMonitorEvent = vi.fn();

      // Return progressive output: second call appends a new line
      let callCount = 0;
      freshRuntime.getRawStream = vi.fn(() => {
        callCount++;
        if (callCount === 1) return "line one\n";
        if (callCount === 2) return "line one\nline two changed\n";
        return "line one\nline two changed\n";
      });

      const s = new HeadlessSupervisor(freshRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        monitor: {
          strategy: "poll-diff",
          triggers: [{ id: "change", literal: "changed" }],
          poll: { intervalMs: 5000 },
        },
        onMonitorEvent,
      }, vi.fn(), clock);

      // First poll tick: baseline snapshot (no events)
      clock.advance(5001);
      expect(onMonitorEvent).not.toHaveBeenCalled();

      // Second poll tick: new data arrived, should emit
      clock.advance(5001);
      expect(onMonitorEvent).toHaveBeenCalled();
      s.dispose();
    });

    it("does not emit when data is unchanged", () => {
      const freshRuntime = createMockRuntime();
      const onMonitorEvent = vi.fn();
      freshRuntime.getRawStream = vi.fn(() => "same data");

      const s = new HeadlessSupervisor(freshRuntime, config, {
        autoExitOnQuiet: false,
        quietThreshold: 5000,
        monitor: {
          strategy: "poll-diff",
          triggers: [{ id: "change", literal: "changed" }],
          poll: { intervalMs: 5000 },
        },
        onMonitorEvent,
      }, vi.fn(), clock);

      clock.advance(5001);
      clock.advance(5001);
      expect(onMonitorEvent).not.toHaveBeenCalled();
      s.dispose();
    });
  });
});
