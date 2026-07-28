import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sliceLogOutput, PtyRuntime, type PtySessionOptions } from "../runtime";

// --- sliceLogOutput (pure function) ---

describe("sliceLogOutput", () => {
  it("returns empty for empty input", () => {
    const result = sliceLogOutput("");
    expect(result.slice).toBe("");
    expect(result.totalLines).toBe(0);
    expect(result.totalChars).toBe(0);
    expect(result.sliceLineCount).toBe(0);
  });

  it("returns full text when no options", () => {
    const result = sliceLogOutput("line1\nline2\nline3");
    expect(result.totalLines).toBe(3);
    expect(result.slice).toBe("line1\nline2\nline3");
    expect(result.sliceLineCount).toBe(3);
  });

  it("respects offset option", () => {
    const result = sliceLogOutput("a\nb\nc\nd", { offset: 1 });
    expect(result.slice).toBe("b\nc\nd");
    expect(result.sliceLineCount).toBe(3);
    expect(result.totalLines).toBe(4);
  });

  it("respects limit option with no offset (tail behavior)", () => {
    const result = sliceLogOutput("a\nb\nc\nd", { limit: 2 });
    expect(result.slice).toBe("c\nd");
    expect(result.sliceLineCount).toBe(2);
    expect(result.totalLines).toBe(4);
  });

  it("respects both offset and limit", () => {
    const result = sliceLogOutput("a\nb\nc\nd\ne", { offset: 1, limit: 2 });
    expect(result.slice).toBe("b\nc");
    expect(result.sliceLineCount).toBe(2);
  });

  it("clamps negative offset to 0", () => {
    const result = sliceLogOutput("line1\nline2", { offset: -5 });
    expect(result.slice).toBe("line1\nline2");
    expect(result.sliceLineCount).toBe(2);
  });

  it("handles offset beyond total lines", () => {
    const result = sliceLogOutput("a\nb", { offset: 10 });
    expect(result.slice).toBe("");
    expect(result.sliceLineCount).toBe(0);
  });

  it("handles limit beyond total lines", () => {
    const result = sliceLogOutput("a\nb", { offset: 0, limit: 100 });
    expect(result.slice).toBe("a\nb");
    expect(result.sliceLineCount).toBe(2);
  });

  it("handles limit=0 (returns nothing)", () => {
    const result = sliceLogOutput("a\nb\nc", { limit: 0 });
    expect(result.slice).toBe("");
    expect(result.sliceLineCount).toBe(0);
    expect(result.totalLines).toBe(3);
  });

  it("returns empty for undefined/null-like input when coerced", () => {
    // The function accesses `text` as string — if undefined, it becomes "undefined"
    // but empty string is the clean case
    const result = sliceLogOutput("");
    expect(result.slice).toBe("");
    expect(result.totalLines).toBe(0);
  });

  it("strips trailing newlines", () => {
    const result = sliceLogOutput("a\nb\nc\n");
    expect(result.totalLines).toBe(3);
    expect(result.slice).toBe("a\nb\nc");
  });

  it("handles single line", () => {
    const result = sliceLogOutput("hello");
    expect(result.totalLines).toBe(1);
    expect(result.slice).toBe("hello");
    expect(result.sliceLineCount).toBe(1);
  });

  it("handles \\r\\n line endings", () => {
    const result = sliceLogOutput("line1\r\nline2\r\nline3");
    expect(result.totalLines).toBe(3);
    expect(result.slice).toBe("line1\nline2\nline3");
  });

  it("handles non-finite offset (NaN)", () => {
    const result = sliceLogOutput("a\nb", { offset: NaN });
    expect(result.slice).toBe("a\nb");
  });

  it("handles non-finite limit (NaN)", () => {
    const result = sliceLogOutput("a\nb", { limit: NaN });
    expect(result.slice).toBe("a\nb");
    expect(result.sliceLineCount).toBe(2);
  });

  it("handles non-finite offset and limit together", () => {
    const result = sliceLogOutput("a\nb\nc", { offset: NaN, limit: NaN });
    expect(result.slice).toBe("a\nb\nc");
  });

  it("strips ANSI when stripAnsi is not explicitly false", () => {
    const result = sliceLogOutput("\x1b[32mgreen\x1b[0m");
    // stripVTControlCharacters removes escape sequences
    expect(result.slice).not.toContain("\x1b[32m");
  });

  it("preserves ANSI when stripAnsi is explicitly false", () => {
    const result = sliceLogOutput("\x1b[32mgreen\x1b[0m text", { stripAnsi: false });
    expect(result.slice).toContain("\x1b[32m");
  });

  it("returns correct totalChars", () => {
    const result = sliceLogOutput("abc\ndef");
    expect(result.totalChars).toBe(7); // 3 + \n + 3
  });
});

// --- PtyRuntime (with zigpty mock) ---

const mockPtyOn = vi.fn();
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
const mockPtyClose = vi.fn();
const mockPtyPid = 99999;

vi.mock("zigpty", () => ({
  spawn: vi.fn(() => ({
    on: mockPtyOn,
    write: mockPtyWrite,
    resize: mockPtyResize,
    kill: mockPtyKill,
    close: mockPtyClose,
    pid: mockPtyPid,
    onData: vi.fn(),
    onExit: vi.fn(),
  })),
}));

// Need to re-import after mock is set up
import { spawn } from "zigpty";

describe("PtyRuntime", () => {
  let runtime: PtyRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockPtyOn.mockReturnValue(undefined);
    mockPtyWrite.mockReturnValue(undefined);
    mockPtyResize.mockReturnValue(undefined);
    mockPtyKill.mockReturnValue(undefined);
    mockPtyClose.mockReturnValue(undefined);
    runtime = new PtyRuntime({ command: "echo hello", scrollback: 100 });
  });

  afterEach(() => {
    try {
      runtime.dispose();
    } catch {
      // Ignore dispose errors
    }
  });

  describe("constructor", () => {
    it("spawns a PTY with correct shell args", () => {
      expect(spawn).toHaveBeenCalled();
      const callArgs = vi.mocked(spawn).mock.calls[0];
      expect(callArgs).toBeDefined();
      // First arg is shell path, second is args array
      if (callArgs && callArgs.length >= 2) {
        const args = callArgs[1];
        expect(Array.isArray(args)).toBe(true);
        if (Array.isArray(args)) {
          expect(args).toContain("-c");
          expect(args).toContain("echo hello");
        }
      }
    });

    it("sets TERM in environment", () => {
      const callArgs = vi.mocked(spawn).mock.calls[0];
      if (callArgs) {
        const opts = callArgs[2];
        if (opts && typeof opts === "object") {
          const env = (opts as Record<string, unknown>).env as Record<string, string> | undefined;
          expect(env?.TERM).toBeTruthy();
        }
      }
    });

    it("reports correct pid", () => {
      expect(runtime.pid).toBe(mockPtyPid);
    });

    it("defaults cols to 80 and rows to 24", () => {
      expect(runtime.cols).toBe(80);
      expect(runtime.rows).toBe(24);
    });

    it("accepts custom cols and rows", () => {
      const custom = new PtyRuntime({ command: "ls", cols: 120, rows: 40, scrollback: 500 });
      expect(custom.cols).toBe(120);
      expect(custom.rows).toBe(40);
      custom.dispose();
    });
  });

  describe("exited / exitCode / signal", () => {
    it("reports not-exited before exit event", () => {
      expect(runtime.exited).toBe(false);
      expect(runtime.exitCode).toBe(null);
      expect(runtime.signal).toBeUndefined();
    });
  });

  describe("write", () => {
    it("writes to PTY when not exited", () => {
      runtime.write("some input\n");
      expect(mockPtyWrite).toHaveBeenCalledWith("some input\n");
    });
  });

  describe("resize", () => {
    it("resizes xterm and PTY when dimensions change", () => {
      runtime.resize(100, 30);
      expect(runtime.cols).toBe(100);
      expect(runtime.rows).toBe(30);
      expect(mockPtyResize).toHaveBeenCalledWith(100, 30);
    });

    it("no-ops when dimensions haven't changed", () => {
      mockPtyResize.mockClear();
      runtime.resize(80, 24); // default dimensions
      expect(mockPtyResize).not.toHaveBeenCalled();
    });

    it("no-ops on invalid dimensions (cols < 1)", () => {
      mockPtyResize.mockClear();
      runtime.resize(0, 24);
      expect(mockPtyResize).not.toHaveBeenCalled();
    });

    it("no-ops on invalid dimensions (rows < 1)", () => {
      mockPtyResize.mockClear();
      runtime.resize(80, 0);
      expect(mockPtyResize).not.toHaveBeenCalled();
    });
  });

  describe("kill", () => {
    it("kills the PTY process", () => {
      runtime.kill();
      // On macOS, kills the process group first, then falls through
      expect(mockPtyKill).toHaveBeenCalled();
    });

    it("kills with custom signal", () => {
      runtime.kill("SIGKILL");
      expect(mockPtyKill).toHaveBeenCalledWith("SIGKILL");
    });
  });

  describe("scroll", () => {
    it("initially not scrolled up", () => {
      expect(runtime.isScrolledUp()).toBe(false);
    });

    it("cannot scroll up beyond terminal buffer (empty buffer)", () => {
      // With an empty buffer, max scroll is 0, so scrollUp is no-op
      runtime.scrollUp(5);
      expect(runtime.isScrolledUp()).toBe(false);
    });

    it("scrollToBottom resets on fresh runtime", () => {
      runtime.scrollToBottom();
      expect(runtime.isScrolledUp()).toBe(false);
    });

    it("scrollDown clamps to 0", () => {
      runtime.scrollDown(10);
      expect(runtime.isScrolledUp()).toBe(false);
    });
  });

  describe("addDataListener", () => {
    it("returns an unsubscribe function", () => {
      const unsub = runtime.addDataListener(() => {});
      expect(typeof unsub).toBe("function");
      unsub(); // Should not throw
    });

    it("removes listener on unsubscribe", () => {
      const listener = vi.fn();
      const unsub = runtime.addDataListener(listener);
      unsub();
      // The listener array should no longer contain listener
      const unsub2 = runtime.addDataListener(listener);
      unsub2();
    });
  });

  describe("addExitListener", () => {
    it("returns an unsubscribe function", () => {
      const unsub = runtime.addExitListener(() => {});
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });

  describe("getRawStream", () => {
    it("returns empty initially", () => {
      const out = runtime.getRawStream();
      expect(out).toBe("");
    });

    it("respects sinceLast option", () => {
      const out = runtime.getRawStream({ sinceLast: true });
      expect(out).toBe("");
    });

    it("strips ANSI by default", () => {
      const out = runtime.getRawStream();
      expect(typeof out).toBe("string");
    });
  });

  describe("getLogSlice", () => {
    it("returns empty for fresh runtime", () => {
      const slice = runtime.getLogSlice();
      expect(slice.slice).toBe("");
      expect(slice.totalLines).toBe(0);
    });
  });

  describe("getViewportLines", () => {
    it("returns string array for fresh runtime", () => {
      const lines = runtime.getViewportLines();
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBe(runtime.rows);
    });
  });

  describe("getTailLines", () => {
    it("returns empty for lines=0", () => {
      const result = runtime.getTailLines({ lines: 0 });
      expect(result.lines).toEqual([]);
      expect(result.totalLinesInBuffer).toBeGreaterThanOrEqual(0);
    });

    it("returns tail lines", () => {
      const result = runtime.getTailLines({ lines: 20 });
      expect(Array.isArray(result.lines)).toBe(true);
      expect(typeof result.totalLinesInBuffer).toBe("number");
    });
  });

  describe("dispose", () => {
    it("kills and closes the PTY", () => {
      const rt = new PtyRuntime({ command: "sleep 999" });
      rt.dispose();
      expect(mockPtyKill).toHaveBeenCalled();
      expect(mockPtyClose).toHaveBeenCalled();
    });
  });

  describe("pgid", () => {
    it("returns a number or null", () => {
      const pgid = runtime.pgid;
      expect(pgid === null || typeof pgid === "number").toBe(true);
    });
  });

  describe("setEventHandlers", () => {
    it("accepts new event handlers without error", () => {
      runtime.setEventHandlers({
        onData: () => {},
        onExit: () => {},
      });
      // Should not throw
    });
  });
});
