import { describe, it, expect } from "vitest";
import {
  renderHeaderLines,
  renderFooterLines,
  renderOverlayFrame,
  statusDot,
  footerLineCount,
  computeTerminalRows,
} from "../frame";
import type { ViewModel } from "../frame";

function vm(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    sessionId: "sess-1",
    command: "pi \"fix bugs\"",
    reason: "debug session",
    pid: 12345,
    focused: true,
    state: "running",
    elapsedMs: 65000,
    width: 120, // Increased to accommodate long footer hints
    viewportLines: ["$ ls", "file1.txt", "file2.txt"],
    isScrolledUp: false,
    exitCode: null,
    focusShortcut: "alt+shift+f",
    dialogSelection: "transfer", // Default for detach-dialog state
    ...overrides,
  };
}

describe("statusDot", () => {
  it("shows checkmark for exit code 0", () => {
    expect(statusDot({ state: "exited", exitCode: 0 })).toBe("✓");
  });
  it("shows cross for non-zero exit code", () => {
    expect(statusDot({ state: "exited", exitCode: 1 })).toBe("✗");
  });
  it("shows bullet for running", () => {
    expect(statusDot({ state: "running", exitCode: null })).toBe("●");
  });
});

describe("footerLineCount", () => {
  it("returns compact count for running", () => {
    expect(footerLineCount("running")).toBe(2);
  });
  it("returns compact count for exited", () => {
    expect(footerLineCount("exited")).toBe(2);
  });
  it("returns dialog count for detach-dialog", () => {
    expect(footerLineCount("detach-dialog")).toBe(6);
  });
  it("returns compact for hands-free", () => {
    expect(footerLineCount("hands-free")).toBe(2);
  });
});

describe("computeTerminalRows", () => {
  it("subtracts header + footer + border chrome", () => {
    // header=4, footer compact=2, border=2 (top+bottom) = 8 chrome
    expect(computeTerminalRows(30, "running")).toBe(22);
  });
  it("uses dialog footer for detach-dialog", () => {
    // header=4, footer dialog=6, border=2 = 12 chrome
    expect(computeTerminalRows(30, "detach-dialog")).toBe(18);
  });
  it("returns 0 for very small heights", () => {
    expect(computeTerminalRows(5, "running")).toBe(0);
  });
});

describe("renderHeaderLines", () => {
  it("produces exactly HEADER_LINES (4) lines", () => {
    const lines = renderHeaderLines(vm());
    expect(lines).toHaveLength(4);
  });

  it("top border uses focused glyphs (╔═══╗)", () => {
    const lines = renderHeaderLines(vm());
    expect(lines[0]).toMatch(/^╔.*╗$/);
  });

  it("uses unfocused glyphs when not focused", () => {
    const lines = renderHeaderLines(vm({ focused: false }));
    expect(lines[0]).toMatch(/^╭.*╮$/);
  });

  it("includes PID in header", () => {
    const lines = renderHeaderLines(vm());
    expect(lines[1]).toContain("PID: 12345");
  });

  it("includes elapsed duration", () => {
    const lines = renderHeaderLines(vm({ elapsedMs: 65000 }));
    expect(lines[2]).toContain("1m 5s");
  });

  it("includes status dot and reason", () => {
    const lines = renderHeaderLines(vm());
    expect(lines[2]).toContain("●");
    expect(lines[2]).toContain("debug session");
  });

  it("omits reason when not provided", () => {
    const lines = renderHeaderLines(vm({ reason: undefined }));
    expect(lines[2]).not.toContain("•");
  });

  it("separator line uses ╠╣ (focused) or ├──┤ (unfocused)", () => {
    const focused = renderHeaderLines(vm());
    expect(focused[3]).toMatch(/^╠.*╣$/);
    const unfocused = renderHeaderLines(vm({ focused: false }));
    expect(unfocused[3]).toMatch(/^├.*┤$/);
  });
});

describe("renderFooterLines", () => {
  it("returns compact count for running", () => {
    const lines = renderFooterLines(vm());
    expect(lines).toHaveLength(2);
  });

  it("includes focus shortcut hint", () => {
    const lines = renderFooterLines(vm());
    expect(lines[0]).toContain("Alt+Shift+f");
  });

  it("shows 'unfocus' when focused, 'focus shell' when not", () => {
    const focused = renderFooterLines(vm({ focused: true }));
    expect(focused[0]).toContain("unfocus");
    const unfocused = renderFooterLines(vm({ focused: false }));
    expect(unfocused[0]).toContain("focus shell");
  });

  it("shows exit message and countdown for exited state", () => {
    const lines = renderFooterLines(vm({
      state: "exited",
      exitCode: 0,
      exitCountdownSeconds: 5,
    }));
    expect(lines[0]).toContain("Exited successfully");
    expect(lines[1]).toContain("Closing in 5s");
  });

  it("shows non-zero exit code", () => {
    const lines = renderFooterLines(vm({
      state: "exited",
      exitCode: 1,
      exitCountdownSeconds: 3,
    }));
    expect(lines[0]).toContain("Exited with code 1");
  });

  it("shows dialog options for detach-dialog", () => {
    const lines = renderFooterLines(vm({
      state: "detach-dialog",
      dialogSelection: "kill",
    }));
    expect(lines).toHaveLength(6);
    expect(lines[3]).toContain("▶ Kill process"); // Kill process is 3rd option (index 2), so line 3
    expect(lines[1]).not.toContain("▶"); // unselected option
  });
});

describe("renderOverlayFrame", () => {
  it("produces a complete frame with top+bottom borders", () => {
    const lines = renderOverlayFrame(vm({ width: 60 }));
    expect(lines[0]).toMatch(/^╔.*╗$/);
    expect(lines[lines.length - 1]).toMatch(/^╚.*╝$/);
  });

  it("includes viewport lines between header and footer", () => {
    const lines = renderOverlayFrame(vm({
      width: 60,
      viewportLines: ["line A", "line B"],
    }));
    // header(4) + viewport(2) + separator(1) + footer(2) + bottom(1) = 10
    expect(lines).toHaveLength(10);
    // viewport lines should be bordered
    expect(lines[4]).toMatch(/^║/);
    expect(lines[4]).toContain("line A");
    expect(lines[5]).toContain("line B");
  });

  it("shows scroll hint when scrolled up", () => {
    const lines = renderOverlayFrame(vm({
      width: 60,
      viewportLines: ["x"],
      isScrolledUp: true,
    }));
    const separator = lines.find(l => l.includes("scrolled up"));
    expect(separator).toBeDefined();
  });

  it("handles empty viewport", () => {
    const lines = renderOverlayFrame(vm({
      width: 40,
      viewportLines: [],
    }));
    // Should not throw, should still have header+footer+chrome
    expect(lines.length).toBeGreaterThan(4);
  });

  it("handles ANSI content in viewport lines", () => {
    const lines = renderOverlayFrame(vm({
      width: 60,
      viewportLines: ["\x1b[32mgreen\x1b[0m text"],
    }));
    // The ANSI content should be preserved in the output
    const viewportLine = lines.find(l => l.includes("green") || l.includes("\x1b["));
    expect(viewportLine).toBeDefined();
  });
});
