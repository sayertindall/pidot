import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildReport } from '../extract.js';

function makeSessionFile(dir: string, lines: string[]): string {
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

function fakeCtx(): ExtensionContext {
  return { cwd: "/fake" } as unknown as ExtensionContext;
}

describe("buildReport", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty report for empty file", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, []);
    const report = await buildReport(file, fakeCtx());
    expect(report.sessionId).toBe("");
    expect(report.sections).toHaveLength(0);
    expect(report.stats.userMessages).toBe(0);
  });

  it("parses session header", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-123",
        timestamp: "2026-01-15T10:00:00.000Z",
        cwd: "/some/project",
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    expect(report.sessionId).toBe("ses-123");
    expect(report.startedAt).toBe(new Date("2026-01-15T10:00:00.000Z").getTime());
    expect(report.sections[0]?.type).toBe("header");
  });

  it("counts user and assistant messages", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-1",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-15T10:01:00.000Z",
        message: { role: "user", content: "Hello" },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-01-15T10:02:00.000Z",
        message: { role: "assistant", content: "Hi there" },
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    expect(report.stats.userMessages).toBe(1);
    expect(report.stats.assistantTurns).toBe(1);
  });

  it("counts tool calls from assistant content blocks", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-1",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-15T10:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me run a command." },
            { type: "toolCall", name: "bash", args: { command: "ls" } },
            { type: "toolCall", name: "read", args: { path: "/x" } },
          ],
        },
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    expect(report.stats.toolCalls).toBe(2);
  });

  it("handles compaction events", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-1",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "compaction",
        id: "c1",
        timestamp: "2026-01-15T10:05:00.000Z",
        summary: "Compacted 100 messages",
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    const compaction = report.sections.find(s => s.type === "compaction");
    expect(compaction).toBeDefined();
    expect(compaction?.body).toContain("Compacted 100 messages");
  });

  it("handles model_change events", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-1",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "model_change",
        id: "mc1",
        timestamp: "2026-01-15T10:01:00.000Z",
        provider: "openai",
        modelId: "gpt-5",
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    expect(report.model).toBe("gpt-5");
  });

  it("computes duration from first and last event", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-test-"));
    const file = makeSessionFile(tmpDir, [
      JSON.stringify({
        type: "session",
        id: "ses-1",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-15T10:01:00.000Z",
        message: { role: "user", content: "hi" },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-01-15T10:05:00.000Z",
        message: { role: "assistant", content: "hello" },
      }),
    ]);
    const report = await buildReport(file, fakeCtx());
    expect(report.durationMs).toBeGreaterThan(0);
    // 10:05:00 - 10:00:00 = 5 min = 300000 ms
    expect(report.durationMs).toBeGreaterThanOrEqual(300000);
  });
});
