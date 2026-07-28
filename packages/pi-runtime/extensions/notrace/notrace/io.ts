import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_REPORT_DIR = join(homedir(), ".pi", "agent", "pi-notrace");

export function getReportDir(): string {
  return process.env.NOTRACE_REPORT_DIR || DEFAULT_REPORT_DIR;
}

export async function writeReport(
  sessionId: string,
  html: string,
  reportDir?: string,
): Promise<string> {
  const dir = reportDir ?? getReportDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.html`);
  writeFileSync(filePath, html, "utf-8");
  return filePath;
}

export async function readSessionJsonl(sessionFile: string): Promise<string[]> {
  const content = readFileSync(sessionFile, "utf-8");
  return content.split("\n").filter(line => line.trim().length > 0);
}
