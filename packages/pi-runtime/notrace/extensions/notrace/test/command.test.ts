import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// vi.mock is hoisted; __mockExecSync is set before the factory runs
let __mockExecSync: ReturnType<typeof vi.fn>;
vi.mock("node:child_process", () => ({
	execSync: (...args: any[]) => __mockExecSync(...args),
}));

const mockExecSync = vi.fn();
__mockExecSync = mockExecSync;

import { notraceCommand } from '../command.js';

function fakeSessionFile(dir: string): string {
  const file = join(dir, "session.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: "session",
        id: "cmd-test-123",
        timestamp: "2026-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-15T10:01:00.000Z",
        message: { role: "user", content: "hello" },
      }),
    ].join("\n"),
    "utf-8",
  );
  return file;
}

function fakeCtx(sessionFile: string | null): ExtensionContext {
  const notify = vi.fn();
  return {
    cwd: "/fake",
    sessionManager: {
      getSessionFile: () => sessionFile,
    },
    ui: { notify },
  } as unknown as ExtensionContext;
}

describe("notraceCommand", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    mockExecSync.mockReset();
  });

  it("notifies error when no active session", async () => {
    const ctx = fakeCtx(null);
    await notraceCommand(undefined, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No active session",
      "error",
    );
  });

  it("writes a report and notifies the path", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-cmd-test-"));
    const file = fakeSessionFile(tmpDir);
    const ctx = fakeCtx(file);

    const oldEnv = process.env.NOTRACE_REPORT_DIR;
    process.env.NOTRACE_REPORT_DIR = tmpDir;

    try {
      await notraceCommand(undefined, ctx);
      const calls = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const lastCall = calls[calls.length - 1] as [string, string];
      expect(lastCall[0]).toContain("Report written to");
      expect(lastCall[0]).toContain("cmd-test-123.html");
      expect(mockExecSync).not.toHaveBeenCalled();
    } finally {
      process.env.NOTRACE_REPORT_DIR = oldEnv;
    }
  });

  it("opens browser with 'open' arg", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-cmd-test-"));
    const file = fakeSessionFile(tmpDir);
    const ctx = fakeCtx(file);

    const oldEnv = process.env.NOTRACE_REPORT_DIR;
    process.env.NOTRACE_REPORT_DIR = tmpDir;

    try {
      await notraceCommand("open", ctx);
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("open "));
    } finally {
      process.env.NOTRACE_REPORT_DIR = oldEnv;
    }
  });
});
