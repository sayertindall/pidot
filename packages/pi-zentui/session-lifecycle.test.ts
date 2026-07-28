import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionLifecycle } from "./session-lifecycle";

// ---------------------------------------------------------------------------
// SessionLifecycle
// ---------------------------------------------------------------------------
describe("SessionLifecycle", () => {
  let lifecycle: SessionLifecycle;

  beforeEach(() => {
    lifecycle = new SessionLifecycle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- Construction ---------------------------------------------------------
  describe("construction", () => {
    it("starts with generation 0", () => {
      expect(lifecycle.currentGeneration()).toBe(0);
    });

    it("is not active initially", () => {
      expect(lifecycle.isCurrent()).toBe(false);
      expect(lifecycle.isCurrent(0)).toBe(false);
    });
  });

  // -- start() --------------------------------------------------------------
  describe("start()", () => {
    it("increments generation and returns the new value", () => {
      const gen = lifecycle.start();
      expect(gen).toBe(1);
      expect(lifecycle.currentGeneration()).toBe(1);
    });

    it("sets active to true", () => {
      lifecycle.start();
      expect(lifecycle.isCurrent(1)).toBe(true);
    });

    it("increments generation on each call", () => {
      expect(lifecycle.start()).toBe(1);
      expect(lifecycle.start()).toBe(2);
      expect(lifecycle.start()).toBe(3);
    });

    it("cancels pending timeouts from previous generation", () => {
      lifecycle.start();
      const callback = vi.fn();
      lifecycle.defer(callback, 100);
      // Start a new generation before the timeout fires
      lifecycle.start();
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // -- isCurrent() ----------------------------------------------------------
  describe("isCurrent()", () => {
    it("returns true for the matching generation when active", () => {
      lifecycle.start();
      expect(lifecycle.isCurrent(1)).toBe(true);
    });

    it("returns false for an old generation", () => {
      lifecycle.start(); // gen 1
      lifecycle.start(); // gen 2
      expect(lifecycle.isCurrent(1)).toBe(false);
    });

    it("returns false when not active (default argument uses internal gen)", () => {
      expect(lifecycle.isCurrent()).toBe(false);
    });

    it("returns false when not active even with matching generation arg", () => {
      expect(lifecycle.isCurrent(0)).toBe(false);
    });
  });

  // -- currentGeneration() --------------------------------------------------
  describe("currentGeneration()", () => {
    it("returns the internal generation number", () => {
      expect(lifecycle.currentGeneration()).toBe(0);
      lifecycle.start();
      expect(lifecycle.currentGeneration()).toBe(1);
    });
  });

  // -- defer() --------------------------------------------------------------
  describe("defer()", () => {
    it("fires callback after the specified delay", () => {
      lifecycle.start();
      const callback = vi.fn();
      lifecycle.defer(callback, 50);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("defaults delay to 0ms", () => {
      lifecycle.start();
      const callback = vi.fn();
      lifecycle.defer(callback);
      vi.advanceTimersByTime(0);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("does not fire for a stale generation after start() is called again", () => {
      lifecycle.start(); // gen 1
      const callback = vi.fn();
      lifecycle.defer(callback, 100);
      lifecycle.start(); // gen 2
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it("cancel function prevents execution", () => {
      lifecycle.start();
      const callback = vi.fn();
      const cancel = lifecycle.defer(callback, 100);
      cancel();
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it("cancel function is idempotent", () => {
      lifecycle.start();
      const callback = vi.fn();
      const cancel = lifecycle.defer(callback, 100);
      cancel();
      cancel(); // second call should not throw
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it("returns a no-op cancel when lifecycle is not active", () => {
      const callback = vi.fn();
      const cancel = lifecycle.defer(callback, 100);
      cancel(); // should not throw
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it("multiple defer() calls all fire in the same generation", () => {
      lifecycle.start();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      lifecycle.defer(cb1, 10);
      lifecycle.defer(cb2, 20);
      vi.advanceTimersByTime(20);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // -- queueMicrotask() -----------------------------------------------------
  describe("queueMicrotask()", () => {
    it("fires callback on the microtask queue", async () => {
      lifecycle.start();
      const callback = vi.fn();
      lifecycle.queueMicrotask(callback);
      // Wait for microtasks to flush
      await vi.runAllTimersAsync();
      // microtasks flush before timers, so just await Promise.resolve()
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("does not fire when lifecycle is not active", async () => {
      const callback = vi.fn();
      lifecycle.queueMicrotask(callback);
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    });

    it("does not fire for stale generation", async () => {
      lifecycle.start(); // gen 1
      const callback = vi.fn();
      lifecycle.queueMicrotask(callback);
      lifecycle.start(); // gen 2, cancels previous
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    });

    it("cancel function prevents execution", async () => {
      lifecycle.start();
      const callback = vi.fn();
      const cancel = lifecycle.queueMicrotask(callback);
      cancel();
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    });

    it("fires for the current generation after rapid start", async () => {
      lifecycle.start(); // gen 1
      lifecycle.start(); // gen 2
      const callback = vi.fn();
      lifecycle.queueMicrotask(callback);
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // -- shutdown() -----------------------------------------------------------
  describe("shutdown()", () => {
    it("clears pending timeouts", () => {
      lifecycle.start();
      const callback = vi.fn();
      lifecycle.defer(callback, 100);
      lifecycle.shutdown();
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it("increments generation", () => {
      lifecycle.start(); // gen 1
      lifecycle.shutdown();
      expect(lifecycle.currentGeneration()).toBe(2);
    });

    it("sets active to false", () => {
      lifecycle.start();
      lifecycle.shutdown();
      expect(lifecycle.isCurrent()).toBe(false);
    });

    it("is a no-op if never started (no timeouts to clear)", () => {
      // Never started, no timeouts — shutdown is a no-op
      lifecycle.shutdown();
      expect(lifecycle.currentGeneration()).toBe(0);
    });

    it("shutdown clears state so start afterward works cleanly", () => {
      lifecycle.start(); // gen 1
      lifecycle.defer(vi.fn(), 100);
      lifecycle.shutdown(); // gen 2, not active
      lifecycle.start(); // gen 3, active
      expect(lifecycle.currentGeneration()).toBe(3);
      expect(lifecycle.isCurrent(3)).toBe(true);
    });
  });

  // -- Multiple sessions ----------------------------------------------------
  describe("multiple session cycles", () => {
    it("properly separates generations across start/shutdown/start", () => {
      lifecycle.start(); // gen 1
      const cb1 = vi.fn();
      lifecycle.defer(cb1, 50);
      lifecycle.shutdown(); // gen 2, cancels cb1

      lifecycle.start(); // gen 3
      const cb2 = vi.fn();
      lifecycle.defer(cb2, 50);

      vi.advanceTimersByTime(50);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // -- Edge: rapid start/shutdown cycles ------------------------------------
  describe("rapid start/shutdown cycles", () => {
    it("handles many rapid cycles without leaking timeouts", () => {
      for (let i = 0; i < 10; i++) {
        lifecycle.start();
        lifecycle.defer(vi.fn(), 1);
        lifecycle.shutdown();
      }
      // Should not throw; generation should be 20 (10 starts + 10 shutdowns, each increments)
      expect(lifecycle.currentGeneration()).toBe(20);
      expect(lifecycle.isCurrent()).toBe(false);
    });

    it("handles start/start/start without shutdown", () => {
      lifecycle.start(); // gen 1
      lifecycle.start(); // gen 2
      lifecycle.start(); // gen 3
      expect(lifecycle.currentGeneration()).toBe(3);
      expect(lifecycle.isCurrent(3)).toBe(true);
      expect(lifecycle.isCurrent(1)).toBe(false);
      expect(lifecycle.isCurrent(2)).toBe(false);
    });
  });
});
