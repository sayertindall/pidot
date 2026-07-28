import { describe, it, expect } from "vitest";
import { renderReport } from '../render.js';
import { DEFAULT_TEMPLATE } from '../template.js';
import type { SessionReport } from '../types.js';

const sampleReport: SessionReport = {
  sessionId: "abc-123-def",
  startedAt: new Date("2026-01-15T10:00:00.000Z").getTime(),
  endedAt: new Date("2026-01-15T10:05:00.000Z").getTime(),
  durationMs: 300_000,
  model: "gpt-5",
  sections: [
    {
      type: "header",
      timestamp: new Date("2026-01-15T10:00:00.000Z").getTime(),
      title: "Session Start",
      body: "Session: abc-123-def",
    },
    {
      type: "user",
      timestamp: new Date("2026-01-15T10:01:00.000Z").getTime(),
      title: "User",
      body: "Hello, can you help?",
    },
    {
      type: "assistant",
      timestamp: new Date("2026-01-15T10:02:00.000Z").getTime(),
      title: "Assistant",
      body: "Sure! What do you need?",
    },
    {
      type: "tool",
      timestamp: new Date("2026-01-15T10:03:00.000Z").getTime(),
      title: "Tool Result",
      body: "Tool: bash\nArgs:\n{\n  \"command\": \"ls\"\n}",
    },
  ],
  stats: {
    userMessages: 1,
    assistantTurns: 1,
    toolCalls: 1,
    filesTouched: 2,
  },
};

describe("renderReport", () => {
  it("renders a complete HTML document", () => {
    const html = renderReport(sampleReport, DEFAULT_TEMPLATE);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  it("includes the session ID in the title", () => {
    const html = renderReport(sampleReport, DEFAULT_TEMPLATE);
    expect(html).toContain("abc-123");
  });

  it("includes stats", () => {
    const html = renderReport(sampleReport, DEFAULT_TEMPLATE);
    expect(html).toContain("User Messages");
    expect(html).toContain("1"); // userMessages count
    expect(html).toContain("Assistant Turns");
    expect(html).toContain("Tool Calls");
    expect(html).toContain("Files Touched");
    expect(html).toContain("2"); // filesTouched count
    expect(html).toContain("5m 0s"); // duration
  });

  it("includes section content", () => {
    const html = renderReport(sampleReport, DEFAULT_TEMPLATE);
    expect(html).toContain("Hello, can you help?");
    expect(html).toContain("Tool: bash");
  });

  it("escapes HTML in section bodies", () => {
    const evil: SessionReport = {
      ...sampleReport,
      sections: [
        {
          type: "user",
          timestamp: 0,
          title: "User",
          body: '<script>alert("xss")</script>',
        },
      ],
    };
    const html = renderReport(evil, DEFAULT_TEMPLATE);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders empty sections gracefully", () => {
    const empty: SessionReport = {
      ...sampleReport,
      sections: [],
      stats: { userMessages: 0, assistantTurns: 0, toolCalls: 0, filesTouched: 0 },
    };
    const html = renderReport(empty, DEFAULT_TEMPLATE);
    expect(html).toContain("<html");
    expect(html).toContain("0");
  });
});
