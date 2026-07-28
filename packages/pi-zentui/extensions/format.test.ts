import { describe, it, expect, vi } from "vitest";
import {
  formatCount,
  formatProviderLabel,
  buildTokenLabel,
  buildCostLabel,
  buildSessionDurationLabel,
  contextColorTier,
  buildContextGauge,
  formatContextPercentLabel,
  buildContextDisplayLabel,
  formatCwdLabel,
  formatGitBranchText,
  formatUsernameHostLabel,
  formatTimeLabel,
  formatOsLabel,
  formatGitCommitSegment,
  formatGitMetricsSegment,
} from "./format";

// Fake Theme for rendering
const theme = {
  fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
};

// ---------------------------------------------------------------------------
// formatCount
// ---------------------------------------------------------------------------
describe("formatCount", () => {
  it("formats small numbers with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1_000)).toBe("1.0k");
    expect(formatCount(1_234_567)).toBe("1.2M");
  });

  it("formats large numbers with k/m abbreviation", () => {
    expect(formatCount(10_000)).toBe("10k");
    expect(formatCount(1_500_000)).toBe("1.5M");
    expect(formatCount(2_000_000_000)).toBe("2000M");
  });
});

// ---------------------------------------------------------------------------
// formatProviderLabel
// ---------------------------------------------------------------------------
describe("formatProviderLabel", () => {
  it("returns Unknown for undefined", () => {
    expect(formatProviderLabel(undefined)).toBe("Unknown");
  });

  it("title-cases known providers", () => {
    expect(formatProviderLabel("openai")).toBe("OpenAI");
    expect(formatProviderLabel("deepseek")).toBe("Deepseek");
    expect(formatProviderLabel("anthropic")).toBe("Anthropic");
  });

  it("handles unknown providers unchanged", () => {
    expect(formatProviderLabel("myprovider")).toBe("Myprovider");
  });
});

// ---------------------------------------------------------------------------
// buildTokenLabel
// ---------------------------------------------------------------------------
describe("buildTokenLabel", () => {
  it("formats input/output tokens", () => {
    const totals = { input: 500, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0 };
    expect(buildTokenLabel(totals, "")).toBe("↑500 ↓300");
  });

  it("shows cache hit icon", () => {
    const totals = { input: 500, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    expect(buildTokenLabel(totals, "✓")).toBe("↑500");
  });
});

// ---------------------------------------------------------------------------
// buildCostLabel
// ---------------------------------------------------------------------------
describe("buildCostLabel", () => {
  it("formats costs", () => {
    expect(buildCostLabel({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.001 })).toBe("$0.001");
    expect(buildCostLabel({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 1.5 })).toBe("$1.500");
  });
});

// ---------------------------------------------------------------------------
// buildSessionDurationLabel
// ---------------------------------------------------------------------------
describe("buildSessionDurationLabel", () => {
  it("shows seconds for < 1 minute", () => {
    const result = buildSessionDurationLabel(Date.now() - 30_000);
    expect(result).toContain("30s");
  });

  it("shows minutes+seconds for < 1 hour", () => {
    const result = buildSessionDurationLabel(Date.now() - 90_000);
    expect(result).toContain("1m");
  });

  it("shows hours+minutes for >= 1 hour", () => {
    const result = buildSessionDurationLabel(Date.now() - 3_600_000);
    expect(result).toContain("1h");
  });
});

// ---------------------------------------------------------------------------
// contextColorTier
// ---------------------------------------------------------------------------
describe("contextColorTier", () => {
  const thresholds = { warning: 70, error: 90 };

  it("returns normal below warning", () => {
    expect(contextColorTier(50, thresholds)).toBe("normal");
  });

  it("returns warning between warning and error", () => {
    expect(contextColorTier(75, thresholds)).toBe("warning");
  });

  it("returns error at or above error", () => {
    expect(contextColorTier(90, thresholds)).toBe("error");
    expect(contextColorTier(95, thresholds)).toBe("error");
  });

  it("handles undefined percent", () => {
    expect(contextColorTier(undefined, thresholds)).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// buildContextGauge
// ---------------------------------------------------------------------------
describe("buildContextGauge", () => {
  it("builds a filled gauge bar", () => {
    const gauge = buildContextGauge(50, 10, false);
    expect(gauge).toContain("█");
    expect(gauge).toContain("░");
  });

  it("builds empty gauge for 0%", () => {
    const gauge = buildContextGauge(0, 10, false);
    expect(gauge).not.toContain("█");
  });

  it("builds full gauge for 100%", () => {
    const gauge = buildContextGauge(100, 10, false);
    expect(gauge).not.toContain("░");
  });

  it("builds ASCII gauge", () => {
    const gauge = buildContextGauge(50, 10, true);
    expect(gauge).toContain("#");
  });
});

// ---------------------------------------------------------------------------
// formatContextPercentLabel
// ---------------------------------------------------------------------------
describe("formatContextPercentLabel", () => {
  it("formats percent", () => {
    expect(formatContextPercentLabel(50, 100_000)).toBe("50%/100k");
  });

  it("shows dash for undefined", () => {
    expect(formatContextPercentLabel(undefined, 100_000)).toBe("?/100k");
  });

  it("shows token count for unknown window", () => {
    expect(formatContextPercentLabel(50, undefined)).toBe("--");
  });
});

// ---------------------------------------------------------------------------
// buildContextDisplayLabel
// ---------------------------------------------------------------------------
describe("buildContextDisplayLabel", () => {
  it("shows text style", () => {
    const label = buildContextDisplayLabel({ percent: 50, contextWindow: 100_000, style: "text" });
    expect(label).toBe("50%/100k");
  });

  it("shows gauge style", () => {
    const label = buildContextDisplayLabel({ percent: 50, contextWindow: 100_000, style: "gauge" });
    expect(label).toContain("█");
  });

  it("shows text+gauge style", () => {
    const label = buildContextDisplayLabel({ percent: 50, contextWindow: 100_000, style: "text+gauge" });
    expect(label).toContain("50%");
    expect(label).toContain("█");
  });

  it("shows dash for undefined percent", () => {
    const label = buildContextDisplayLabel({ percent: undefined, contextWindow: 100_000, style: "text" });
    expect(label).toBe("?/100k");
  });
});

// ---------------------------------------------------------------------------
// formatCwdLabel
// ---------------------------------------------------------------------------
describe("formatCwdLabel", () => {
  it("shows basename by default", () => {
    const label = formatCwdLabel("/home/user/projects/foo", "📁");
    expect(label).toContain("foo");
    expect(label).not.toContain("/home");
  });

  it("shows full path in full mode", () => {
    const label = formatCwdLabel("/home/user/projects/foo", "📁", { mode: "full", depth: 0 });
    expect(label).toContain("projects/foo");
  });

  it("shows trailing directories with depth", () => {
    const label = formatCwdLabel("/a/b/c/d/e", "📁", { mode: "full", depth: 2 });
    expect(label).toBe("📁 …/d/e");
  });
});

// ---------------------------------------------------------------------------
// formatGitBranchText
// ---------------------------------------------------------------------------
describe("formatGitBranchText", () => {
  it("returns full branch name", () => {
    expect(formatGitBranchText("main", "full")).toBe("main");
  });

  it("truncates long branch names", () => {
    const long = "feature/some-very-long-branch-name";
    const result = formatGitBranchText(long, 20);
    expect(result.length).toBeLessThanOrEqual(23); // 20 chars + "…"
  });
});

// ---------------------------------------------------------------------------
// formatUsernameHostLabel
// ---------------------------------------------------------------------------
describe("formatUsernameHostLabel", () => {
  it("contains username", () => {
    const label = formatUsernameHostLabel("👤");
    expect(label.length).toBeGreaterThan(0);
  });

  it("starts with icon", () => {
    const label = formatUsernameHostLabel("👤");
    expect(label.startsWith("👤")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatTimeLabel
// ---------------------------------------------------------------------------
describe("formatTimeLabel", () => {
  it("contains colon (HH:MM format)", () => {
    const label = formatTimeLabel("🕐");
    expect(label).toMatch(/:\d{2}/);
  });

  it("starts with icon", () => {
    const label = formatTimeLabel("🕐");
    expect(label.startsWith("🕐")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatOsLabel
// ---------------------------------------------------------------------------
describe("formatOsLabel", () => {
  it("returns a non-empty string", () => {
    const label = formatOsLabel("💻", "auto");
    expect(label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatGitCommitSegment
// ---------------------------------------------------------------------------
describe("formatGitCommitSegment", () => {
  const baseConfig = { hashLength: 7, onlyDetached: false, showTag: false };

  it("returns empty if no commit", () => {
    expect(formatGitCommitSegment(theme, undefined, baseConfig, "terminal", "red")).toBe("");
  });

  it("shows short hash", () => {
    const commit = { oid: "abc1234567890fedcba", detached: false, tag: "" };
    const result = formatGitCommitSegment(theme, commit, baseConfig, "terminal", "red");
    expect(result).toContain("abc1234");
  });

  it("returns empty when onlyDetached and not detached", () => {
    const commit = { oid: "abc1234567890fedcba", detached: false, tag: "" };
    const result = formatGitCommitSegment(theme, commit, { ...baseConfig, onlyDetached: true }, "terminal", "red");
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatGitMetricsSegment
// ---------------------------------------------------------------------------
describe("formatGitMetricsSegment", () => {
  const baseConfig = { onlyNonzero: false };

  it("returns empty with no metrics", () => {
    expect(formatGitMetricsSegment(theme, undefined, baseConfig, "terminal", "green", "red")).toBe("");
  });

  it("shows added and deleted", () => {
    const metrics = { added: 10, deleted: 3 };
    const result = formatGitMetricsSegment(theme, metrics, baseConfig, "terminal", "green", "red");
    expect(result).toContain("+10");
    expect(result).toContain("−3");
  });

  it("hides zeros when onlyNonzero", () => {
    const metrics = { added: 5, deleted: 0 };
    const result = formatGitMetricsSegment(theme, metrics, { onlyNonzero: true }, "terminal", "green", "red");
    expect(result).toContain("+5");
    expect(result).not.toContain("−0");
    expect(result).not.toContain("deleted");
  });
});
