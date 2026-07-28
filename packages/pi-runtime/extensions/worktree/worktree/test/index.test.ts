import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We mock SessionManager at the module level
vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual("@earendil-works/pi-coding-agent");
  return {
    ...actual,
    SessionManager: {
      forkFrom: vi.fn(),
    },
  };
});

import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  isPendingWorktreeSwitch,
  setPendingWorktreeSwitch,
} from '../state';

interface CapturedTool {
  name: string;
  label: string;
  description: string;
  execute: (...args: any[]) => Promise<any>;
}

interface CapturedCommand {
  name: string;
  description: string;
  handler: (args: string | undefined, ctx: any) => Promise<void>;
}

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

let tools: CapturedTool[] = [];
let commands: CapturedCommand[] = [];
let inputHandlers: EventHandler[] = [];
let eventsEmitted: Array<{ event: string; payload: unknown }> = [];
let setStatusCalls: Array<{ key: string; value: string | undefined }> = [];

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pi-worktree-idx-"));
  tools = [];
  commands = [];
  inputHandlers = [];
  eventsEmitted = [];
  setStatusCalls = [];
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  setPendingWorktreeSwitch(false);
});

function fakePi(execOverrides?: (cmd: string, args: readonly string[], opts?: any) => Promise<any>) {
  const exec = fakeExec(execOverrides);

  return {
    registerTool: (def: any) => {
      tools.push({
        name: def.name,
        label: def.label,
        description: def.description,
        execute: def.execute,
      });
    },
    registerCommand: (name: string, def: any) => {
      commands.push({ name, description: def.description, handler: def.handler });
    },
    on: (event: string, handler: EventHandler) => {
      if (event === "input") {
        inputHandlers.push(handler);
      }
    },
    exec,
    events: {
      emit: (event: string, payload: unknown) => {
        eventsEmitted.push({ event, payload });
      },
    },
  } as any;
}

function fakeExec(overrides?: (cmd: string, args: readonly string[], opts?: any) => Promise<any>) {
  const fn = async (cmd: string, args: readonly string[], opts?: any) => {
    if (overrides) return overrides(cmd, args, opts);

    // Default: run real git commands
    try {
      const stdout = execFileSync(cmd, args as string[], {
        cwd: opts?.cwd,
        timeout: opts?.timeout,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout, stderr: "", killed: false };
    } catch (err: any) {
      return {
        code: err.status ?? 1,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
        killed: err.killed ?? false,
      };
    }
  };
  return fn;
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: tmp,
    sessionManager: {
      getSessionFile: () => join(tmp, "session.jsonl"),
    },
    ui: {
      setStatus: (key: string, value: string | undefined) => {
        setStatusCalls.push({ key, value });
      },
      notify: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      setEditorText: vi.fn(),
    },
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function initGitRepo(cwd: string): void {
  execFileSync("git", ["init"], { cwd });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  writeFileSync(join(cwd, "test.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-m", "init"], { cwd });
}

async function importExtension() {
  const mod = await import("../index");
  return mod.default;
}

describe("worktree extension factory", () => {
  it("registers the switch_worktree tool", async () => {
    const factory = await importExtension();
    factory(fakePi());
    const tool = tools.find((t) => t.name === "switch_worktree");
    expect(tool).toBeDefined();
    expect(tool!.label).toBe("Switch Worktree");
  });

  it("registers the /switch-worktree command", async () => {
    const factory = await importExtension();
    factory(fakePi());
    const cmd = commands.find((c) => c.name === "switch-worktree");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain("Relocate");
  });

  it("registers an input event handler", async () => {
    const factory = await importExtension();
    factory(fakePi());
    expect(inputHandlers).toHaveLength(1);
  });

  it("input handler clears block when source is interactive", async () => {
    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);
    setPendingWorktreeSwitch(true);

    const ctx = fakeCtx();
    await inputHandlers[0]!({ source: "interactive" }, ctx);

    expect(isPendingWorktreeSwitch()).toBe(false);
    // Should have emitted herdr:blocked { active: false } if HERDR_ENV
  });
});

describe("switch_worktree tool", () => {
  it("validates target and prefills editor", async () => {
    initGitRepo(tmp);

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const tool = tools.find((t) => t.name === "switch_worktree")!;
    const ctx = fakeCtx({ cwd: tmp });

    const result = await tool.execute(
      "call-1",
      { path: "." },
      undefined,
      undefined,
      ctx,
    );

    // Should have set editor text with /switch-worktree
    expect(ctx.ui.setEditorText).toHaveBeenCalled();
    const editorCall = (ctx.ui.setEditorText as any).mock.calls[0][0];
    expect(editorCall).toContain("/switch-worktree");

    // Should have set status for worktree block
    expect(setStatusCalls.some((c) => c.key === "worktree")).toBe(true);

    // Should return details
    expect(result.details.worktreePath).toBeDefined();
    expect(result.details.branch).toBe("main");
  });

  it("throws for non-existent path", async () => {
    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const tool = tools.find((t) => t.name === "switch_worktree")!;
    const ctx = fakeCtx();

    await expect(
      tool.execute("call-1", { path: "/nonexistent/xyz" }, undefined, undefined, ctx),
    ).rejects.toThrow("Path does not exist");
  });

  it("throws for a non-git directory", async () => {
    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const tool = tools.find((t) => t.name === "switch_worktree")!;
    const nonGitDir = mkdtempSync(join(tmpdir(), "pi-worktree-nogit-"));
    const ctx = fakeCtx();

    try {
      await expect(
        tool.execute("call-1", { path: nonGitDir }, undefined, undefined, ctx),
      ).rejects.toThrow("Not a git working tree");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("strips leading @ from path", async () => {
    initGitRepo(tmp);

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const tool = tools.find((t) => t.name === "switch_worktree")!;
    const ctx = fakeCtx({ cwd: "/" });

    // Path resolution: resolve("/", tmp) should work even with @ prefix stripped
    const result = await tool.execute(
      "call-2",
      { path: `@${tmp}` },
      undefined,
      undefined,
      ctx,
    );

    // realpath resolves /tmp symlinks on macOS, so compare resolved paths
    expect(result.details.worktreePath).toBe(realpathSync(tmp));
    expect(result.details.branch).toBe("main");
  });
});

describe("/switch-worktree command", () => {
  it("notifies error on empty args", async () => {
    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;
    const ctx = fakeCtx();
    await cmd.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /switch-worktree <worktree-path>",
      "error",
    );
  });

  it("notifies error for non-git directory", async () => {
    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;
    const nonGitDir = mkdtempSync(join(tmpdir(), "pi-worktree-nogit-"));
    const ctx = fakeCtx();

    try {
      await cmd.handler(nonGitDir, ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Not a git working tree"),
        "error",
      );
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("notifies error when session is not persisted", async () => {
    initGitRepo(tmp);

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;
    const ctx = fakeCtx({
      sessionManager: { getSessionFile: () => null },
    });

    await cmd.handler(tmp, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Session is not persisted, cannot switch worktree",
      "error",
    );
  });

  it("cancels when user declines confirmation", async () => {
    initGitRepo(tmp);

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;
    const ctx = fakeCtx({
      ui: {
        ...fakeCtx().ui,
        confirm: vi.fn().mockResolvedValue(false),
        notify: vi.fn(),
      },
    });

    await cmd.handler(tmp, ctx);

    expect(ctx.ui.confirm).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Worktree switch cancelled", "info");
    expect(ctx.switchSession).not.toHaveBeenCalled();
  });

  it("happy path: confirms, forks session, switches", async () => {
    initGitRepo(tmp);

    // Create a dummy session file
    const sessionFile = join(tmp, "session.jsonl");
    writeFileSync(sessionFile, '{"type":"header"}\n{"type":"turn"}\n');

    // Mock SessionManager.forkFrom to return a fake forked session
    const forkedFile = join(tmp, "forked.jsonl");
    writeFileSync(forkedFile, '{"type":"header","parentSession":"old"}\n{"type":"turn"}\n');

    const forkedSession = {
      getSessionFile: () => forkedFile,
    };
    (SessionManager.forkFrom as any).mockReturnValue(forkedSession);

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;

    let switchCalled = false;
    let withSessionCb: ((newCtx: any) => Promise<void>) | null = null;

    const ctx = fakeCtx({
      sessionManager: { getSessionFile: () => sessionFile },
      switchSession: vi.fn(async (_file: string, opts: any) => {
        switchCalled = true;
        withSessionCb = opts.withSession;
        return { cancelled: false };
      }),
    });

    await cmd.handler(tmp, ctx);

    expect(switchCalled).toBe(true);
    expect(SessionManager.forkFrom).toHaveBeenCalledWith(sessionFile, realpathSync(tmp));

    // Invoke the withSession callback
    const newCtx = fakeCtx();
    await withSessionCb!(newCtx);

    expect(newCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Session relocated to worktree"),
      "info",
    );
    expect(newCtx.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Continue working"),
    );
  });

  it("handles switchSession cancellation", async () => {
    initGitRepo(tmp);

    const sessionFile = join(tmp, "session.jsonl");
    writeFileSync(sessionFile, '{"type":"header"}\n');

    const forkedFile = join(tmp, "forked.jsonl");
    writeFileSync(forkedFile, '{"type":"header"}\n');

    (SessionManager.forkFrom as any).mockReturnValue({
      getSessionFile: () => forkedFile,
    });

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;

    const ctx = fakeCtx({
      sessionManager: { getSessionFile: () => sessionFile },
      switchSession: vi.fn(async () => ({ cancelled: true })),
    });

    await cmd.handler(tmp, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Worktree switch was cancelled by another extension",
      "info",
    );
  });

  it("handles SessionManager.forkFrom failure", async () => {
    initGitRepo(tmp);

    const sessionFile = join(tmp, "session.jsonl");
    writeFileSync(sessionFile, '{"type":"header"}\n');

    (SessionManager.forkFrom as any).mockImplementation(() => {
      throw new Error("Fork failed: disk full");
    });

    const factory = await importExtension();
    const pi = fakePi();
    factory(pi);

    const cmd = commands.find((c) => c.name === "switch-worktree")!;

    const ctx = fakeCtx({
      sessionManager: { getSessionFile: () => sessionFile },
    });

    await cmd.handler(tmp, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to switch worktree"),
      "error",
    );
  });
});
