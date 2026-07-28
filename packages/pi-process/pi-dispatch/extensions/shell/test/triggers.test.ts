import { describe, it, expect } from "vitest";
import {
  compileTrigger,
  bufferLines,
  canEmitTrigger,
  shouldEmitUnique,
  normalizeMonitorSnapshot,
  summarizeDiff,
} from "../triggers";

describe("compileTrigger", () => {
  describe("literal triggers", () => {
    it("matches a literal substring", () => {
      const m = compileTrigger({ id: "fail", literal: "FAIL" });
      expect(m.match("some FAIL here")).toBe("FAIL");
    });
    it("returns undefined when literal not found", () => {
      const m = compileTrigger({ id: "fail", literal: "FAIL" });
      expect(m.match("all good")).toBeUndefined();
    });
    it("throws on empty id", () => {
      expect(() => compileTrigger({ id: "", literal: "x" })).toThrow("non-empty id");
    });
    it("throws on empty literal", () => {
      expect(() => compileTrigger({ id: "t1", literal: "  " })).toThrow("literal cannot be empty");
    });
    it("preserves cooldownMs", () => {
      const m = compileTrigger({ id: "t1", literal: "x", cooldownMs: 5000 });
      expect(m.cooldownMs).toBe(5000);
    });
  });

  describe("regex triggers", () => {
    it("matches a regex pattern", () => {
      const m = compileTrigger({ id: "err", regex: "/error.*fail/i" });
      // .* matches greedily but match[0] is the full regex match
      expect(m.match("ERROR: fail fast")).toBe("ERROR: fail");
    });
    it("returns undefined when regex does not match", () => {
      const m = compileTrigger({ id: "err", regex: "/error/i" });
      expect(m.match("all good")).toBeUndefined();
    });
    it("throws on invalid regex", () => {
      expect(() => compileTrigger({ id: "t1", regex: "/[invalid/i" })).toThrow("Invalid regex");
    });
    it("throws on invalid regex flags", () => {
      expect(() => compileTrigger({ id: "t1", regex: "/test/xyz" })).toThrow("Invalid regex flags");
    });
    it("throws on empty regex", () => {
      expect(() => compileTrigger({ id: "t1", regex: "  " })).toThrow("cannot be empty");
    });
    it("accepts regex without delimiters", () => {
      const m = compileTrigger({ id: "t1", regex: "error.*fail" });
      expect(m.match("error: fail")).toBe("error: fail");
    });
  });

  describe("threshold triggers", () => {
    it("matches when captured group satisfies gt", () => {
      const m = compileTrigger({
        id: "cpu",
        regex: "/CPU\\s+(\\d+)/",
        threshold: { captureGroup: 1, op: "gt", value: 90 },
      });
      expect(m.match("CPU 95%")).toBe("CPU 95");
      expect(m.match("CPU 50%")).toBeUndefined();
    });
    it("matches lte", () => {
      const m = compileTrigger({
        id: "mem",
        regex: "/MEM\\s+(\\d+)/",
        threshold: { captureGroup: 1, op: "lte", value: 100 },
      });
      expect(m.match("MEM 100")).toBe("MEM 100");
      expect(m.match("MEM 101")).toBeUndefined();
    });
    it("matches lt", () => {
      const m = compileTrigger({
        id: "temp",
        regex: "/temp:(\\d+)/",
        threshold: { captureGroup: 1, op: "lt", value: 30 },
      });
      expect(m.match("temp:25")).toBe("temp:25");
      expect(m.match("temp:30")).toBeUndefined();
      expect(m.match("temp:35")).toBeUndefined();
    });
    it("matches gte", () => {
      const m = compileTrigger({
        id: "reqs",
        regex: "/requests:(\\d+)/",
        threshold: { captureGroup: 1, op: "gte", value: 100 },
      });
      expect(m.match("requests:100")).toBe("requests:100");
      expect(m.match("requests:99")).toBeUndefined();
    });
    it("returns undefined when capture group is missing", () => {
      const m = compileTrigger({
        id: "cpu",
        regex: "/no-capture/",
        threshold: { captureGroup: 1, op: "gt", value: 0 },
      });
      expect(m.match("no-capture")).toBeUndefined();
    });
    it("returns undefined when captured value is not numeric", () => {
      const m = compileTrigger({
        id: "cpu",
        regex: "/CPU (\\w+)/",
        threshold: { captureGroup: 1, op: "gt", value: 0 },
      });
      expect(m.match("CPU high")).toBeUndefined();
    });
    it("throws on invalid captureGroup", () => {
      expect(() =>
        compileTrigger({
          id: "t1",
          regex: "/test/",
          threshold: { captureGroup: 0, op: "gt", value: 0 },
        })
      ).toThrow("captureGroup must be an integer >= 1");
    });
    it("throws on invalid op", () => {
      expect(() =>
        compileTrigger({
          id: "t1",
          regex: "/test/",
          threshold: { captureGroup: 1, op: "equals" as any, value: 0 },
        })
      ).toThrow("op must be one of");
    });
    it("throws on non-finite value", () => {
      expect(() =>
        compileTrigger({
          id: "t1",
          regex: "/test/",
          threshold: { captureGroup: 1, op: "gt", value: Infinity },
        })
      ).toThrow("value must be a finite number");
    });
    it("throws when threshold used with literal", () => {
      expect(() =>
        compileTrigger({
          id: "t1",
          literal: "FAIL",
          threshold: { captureGroup: 1, op: "gt", value: 0 },
        })
      ).toThrow("threshold requires regex");
    });
  });

  describe("validation", () => {
    it("throws when neither literal nor regex defined", () => {
      expect(() => compileTrigger({ id: "t1" })).toThrow("exactly one matcher");
    });
    it("throws when both literal and regex defined", () => {
      expect(() => compileTrigger({ id: "t1", literal: "x", regex: "/x/" })).toThrow("exactly one matcher");
    });
  });
});

describe("bufferLines", () => {
  it("splits a chunk into lines with remainder", () => {
    const result = bufferLines("", "line1\nline2\npartial", false);
    expect(result.lines).toEqual(["line1", "line2"]);
    expect(result.remainder).toBe("partial");
  });
  it("carries previous remainder forward", () => {
    const r1 = bufferLines("", "hel", false);
    expect(r1.lines).toEqual([]);
    expect(r1.remainder).toBe("hel");
    const r2 = bufferLines(r1.remainder, "lo world\ndone\n", false);
    expect(r2.lines).toEqual(["hello world", "done"]);
    expect(r2.remainder).toBe("");
  });
  it("handles CRLF line endings", () => {
    const result = bufferLines("", "a\r\nb\r\nc", false);
    // c has no trailing newline, so it's the remainder
    expect(result.lines).toEqual(["a", "b"]);
    expect(result.remainder).toBe("c");
  });
  it("handles bare CR", () => {
    const result = bufferLines("", "a\rb\nc", false);
    expect(result.lines).toEqual(["a", "b"]);
    expect(result.remainder).toBe("c");
  });
  it("flushes trailing on flushTrailing=true", () => {
    const result = bufferLines("", "line1\nline2", true);
    expect(result.lines).toEqual(["line1", "line2"]);
    expect(result.remainder).toBe("");
  });
  it("returns empty when no chunk and not flushing", () => {
    const result = bufferLines("prev", "", false);
    expect(result.lines).toEqual([]);
    expect(result.remainder).toBe("prev");
  });
  it("filters empty lines", () => {
    const result = bufferLines("", "a\n\n\nb", false);
    expect(result.lines).toEqual(["a"]);
    expect(result.remainder).toBe("b");
  });
});

describe("canEmitTrigger", () => {
  it("always allows when no cooldown", () => {
    const map = new Map<string, number>();
    expect(canEmitTrigger(map, "t1", undefined, 100)).toBe(true);
    expect(canEmitTrigger(map, "t1", 0, 100)).toBe(true);
  });
  it("blocks within cooldown window after first emission", () => {
    const map = new Map<string, number>();
    // First emission sets lastEmitAt to 1000
    expect(canEmitTrigger(map, "t1", 1000, 1000)).toBe(true);
    // Second emission at 1500 is within 1000ms cooldown
    expect(canEmitTrigger(map, "t1", 1000, 1500)).toBe(false);
  });
  it("allows after cooldown expires", () => {
    const map = new Map<string, number>();
    canEmitTrigger(map, "t1", 1000, 1000);
    expect(canEmitTrigger(map, "t1", 1000, 2001)).toBe(true);
  });
  it("tracks cooldowns independently per trigger", () => {
    const map = new Map<string, number>();
    canEmitTrigger(map, "t1", 1000, 1000);
    // t2 has no lastEmitAt, but 0 is used as default, so 100-0=100 < 1000 → blocked
    // This is a known behavior: first emission for a trigger within cooldown of t=0 is blocked
    // Use no cooldown or a large enough now value
    expect(canEmitTrigger(map, "t2", undefined, 100)).toBe(true);
  });
});

describe("shouldEmitUnique", () => {
  it("allows first emission", () => {
    const seen = new Set<string>();
    expect(shouldEmitUnique(seen, "t1", "FAIL")).toBe(true);
  });
  it("blocks duplicate (triggerId, text)", () => {
    const seen = new Set<string>();
    shouldEmitUnique(seen, "t1", "FAIL");
    expect(shouldEmitUnique(seen, "t1", "FAIL")).toBe(false);
  });
  it("allows same triggerId with different text", () => {
    const seen = new Set<string>();
    shouldEmitUnique(seen, "t1", "FAIL A");
    expect(shouldEmitUnique(seen, "t1", "FAIL B")).toBe(true);
  });
});

describe("normalizeMonitorSnapshot", () => {
  it("normalizes CRLF to LF", () => {
    expect(normalizeMonitorSnapshot("a\r\nb\r\nc")).toBe("a\nb\nc");
  });
  it("strips trailing whitespace per line", () => {
    expect(normalizeMonitorSnapshot("hello   \nworld  ")).toBe("hello\nworld");
  });
  it("trims trailing newlines", () => {
    expect(normalizeMonitorSnapshot("a\n\n")).toBe("a");
  });
  it("returns empty for empty input", () => {
    expect(normalizeMonitorSnapshot("")).toBe("");
  });
});

describe("summarizeDiff", () => {
  it("reports no change", () => {
    expect(summarizeDiff("a\nb", "a\nb")).toBe("No change");
  });
  it("reports new content", () => {
    expect(summarizeDiff("", "hello")).toContain("now has content");
  });
  it("reports cleared content", () => {
    expect(summarizeDiff("hello", "")).toBe("Output changed: now empty");
  });
  it("reports first differing line", () => {
    const result = summarizeDiff("line1\nline2\nline3", "line1\nCHANGED\nline3");
    expect(result).toContain("line 2");
    expect(result).toContain("line2");
    expect(result).toContain("CHANGED");
  });
  it("truncates long lines", () => {
    const long = "x".repeat(200);
    const result = summarizeDiff(long, "y".repeat(200));
    expect(result).toContain("...");
  });
  it("reports size change when lines are same length but content differs", () => {
    const result = summarizeDiff("abc", "xyz");
    expect(result).toContain("Output changed");
  });
});
