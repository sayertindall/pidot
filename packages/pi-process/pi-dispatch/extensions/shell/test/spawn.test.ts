import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSpawnArgs } from "../spawn";

describe("parseSpawnArgs", () => {
  it("parses a bare agent name", () => {
    const result = parseSpawnArgs("claude");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBe("claude");
      expect(result.parsed.request.mode).toBeUndefined();
      expect(result.parsed.request.worktree).toBeUndefined();
      expect(result.parsed.monitorMode).toBeUndefined();
    }
  });

  it("parses agent + mode (fresh)", () => {
    const result = parseSpawnArgs("pi fresh");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBe("pi");
      expect(result.parsed.request.mode).toBe("fresh");
    }
  });

  it("parses agent + mode (fork)", () => {
    const result = parseSpawnArgs("codex fork");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.mode).toBe("fork");
    }
  });

  it("parses --worktree flag", () => {
    const result = parseSpawnArgs("pi --worktree");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.worktree).toBe(true);
    }
  });

  it("parses --hands-free with prompt", () => {
    const result = parseSpawnArgs('claude "review diffs" --hands-free');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.monitorMode).toBe("hands-free");
      expect(result.parsed.request.prompt).toBe("review diffs");
      expect(result.parsed.request.agent).toBe("claude");
    }
  });

  it("parses --dispatch with prompt", () => {
    const result = parseSpawnArgs('cursor "check code" --dispatch');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.monitorMode).toBe("dispatch");
      expect(result.parsed.request.prompt).toBe("check code");
      expect(result.parsed.request.agent).toBe("cursor");
    }
  });

  it("parses full spec with all flags", () => {
    const result = parseSpawnArgs('pi fresh "do work" --dispatch --worktree');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBe("pi");
      expect(result.parsed.request.mode).toBe("fresh");
      expect(result.parsed.request.worktree).toBe(true);
      expect(result.parsed.request.prompt).toBe("do work");
      expect(result.parsed.monitorMode).toBe("dispatch");
    }
  });

  it("parses gemini agent", () => {
    const result = parseSpawnArgs("gemini");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBe("gemini");
    }
  });

  it("rejects duplicate --worktree", () => {
    const result = parseSpawnArgs("pi --worktree --worktree");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Duplicate flag: --worktree");
    }
  });

  it("rejects duplicate --hands-free", () => {
    const result = parseSpawnArgs('pi "task" --hands-free --hands-free');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Duplicate flag: --hands-free");
    }
  });

  it("rejects combining --hands-free and --dispatch", () => {
    const result = parseSpawnArgs('pi "task" --hands-free --dispatch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Cannot combine --hands-free and --dispatch.");
    }
  });

  it("rejects duplicate agent", () => {
    const result = parseSpawnArgs("pi claude");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Duplicate spawn agent: claude");
    }
  });

  it("rejects duplicate spawn mode", () => {
    const result = parseSpawnArgs("pi fresh fork");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Duplicate spawn mode: fork");
    }
  });

  it("rejects unknown flags", () => {
    const result = parseSpawnArgs("pi --unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unknown /spawn argument: --unknown");
    }
  });

  it("rejects unknown bare words", () => {
    const result = parseSpawnArgs("pi something");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unknown /spawn argument: something");
    }
  });

  it("rejects multiple quoted prompts", () => {
    const result = parseSpawnArgs('"prompt one" "prompt two" --hands-free');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Prompt text must be quoted as a single argument");
    }
  });

  it("rejects prompt without --hands-free or --dispatch", () => {
    const result = parseSpawnArgs('claude "review"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Prompt-bearing /spawn requires --hands-free or --dispatch.");
    }
  });

  it("rejects --hands-free without a prompt", () => {
    const result = parseSpawnArgs("claude --hands-free");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Monitored /spawn requires a quoted prompt, for example /spawn claude "review the diffs" --dispatch.');
    }
  });

  it("rejects --dispatch without a prompt", () => {
    const result = parseSpawnArgs("pi --dispatch");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Monitored /spawn requires a quoted prompt");
    }
  });

  it("rejects unterminated quote", () => {
    const result = parseSpawnArgs('claude "unterminated');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unterminated quote in /spawn arguments.");
    }
  });

  it("handles empty string", () => {
    const result = parseSpawnArgs("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBeUndefined();
    }
  });

  it("handles whitespace-only string", () => {
    const result = parseSpawnArgs("   ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.agent).toBeUndefined();
    }
  });

  it("parses single-quoted prompt", () => {
    const result = parseSpawnArgs("claude 'single quoted prompt' --hands-free");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.prompt).toBe("single quoted prompt");
    }
  });

  it("parses --dispatch placed before prompt", () => {
    const result = parseSpawnArgs('--dispatch claude "review"');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.monitorMode).toBe("dispatch");
      expect(result.parsed.request.agent).toBe("claude");
      expect(result.parsed.request.prompt).toBe("review");
    }
  });

  it("parses --worktree as only flag (no monitor)", () => {
    const result = parseSpawnArgs("pi --worktree");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.worktree).toBe(true);
      expect(result.parsed.monitorMode).toBeUndefined();
    }
  });

  it("handles escaped characters inside quotes", () => {
    const result = parseSpawnArgs('claude "hello \\"world\\"" --hands-free');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.request.prompt).toContain("hello");
    }
  });
});
