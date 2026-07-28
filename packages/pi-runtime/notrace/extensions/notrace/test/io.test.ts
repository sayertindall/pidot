import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeReport, readSessionJsonl } from '../io.js';

describe("writeReport", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a report and returns the path", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-io-test-"));
    const path = await writeReport("session-123", "<html>test</html>", tmpDir);
    expect(path).toContain("session-123.html");
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("<html>test</html>");
  });

  it("overwrites an existing report", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-io-test-"));
    await writeReport("dup-session", "first", tmpDir);
    const path = await writeReport("dup-session", "second", tmpDir);
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("second");
  });

  it("uses default report dir when none provided", async () => {
    const path = await writeReport("ci-test-session", "test");
    expect(path).toContain("ci-test-session.html");
    expect(path).toContain(".pi");
  });
});

describe("readSessionJsonl", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a JSONL file and returns lines", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-io-test-"));
    const filePath = join(tmpDir, "test.jsonl");
    writeFileSync(filePath, "line1\nline2\nline3\n", "utf-8");
    const lines = await readSessionJsonl(filePath);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("line1");
    expect(lines[1]).toBe("line2");
    expect(lines[2]).toBe("line3");
  });

  it("filters empty lines", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "notrace-io-test-"));
    const filePath = join(tmpDir, "test.jsonl");
    writeFileSync(filePath, "line1\n\nline2\n  \nline3\n", "utf-8");
    const lines = await readSessionJsonl(filePath);
    expect(lines).toHaveLength(3);
  });
});
