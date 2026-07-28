import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { buildReport } from "./extract.js";
import { writeReport } from "./io.js";
import { renderReport } from "./render.js";
import { DEFAULT_TEMPLATE } from "./template.js";

export async function notraceCommand(
  args: string | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) {
    ctx.ui.notify("No active session", "error");
    return;
  }

  const report = await buildReport(sessionFile, ctx);
  const html = renderReport(report, DEFAULT_TEMPLATE);
  const filePath = await writeReport(report.sessionId || "unknown", html);

  ctx.ui.notify(`Report written to ${filePath}`, "info");

  const trimmed = args?.trim().toLowerCase();
  if (trimmed === "open") {
    try {
      const platform = process.platform;
      if (platform === "darwin") {
        execSync(`open "${filePath}"`);
      } else if (platform === "linux") {
        execSync(`xdg-open "${filePath}"`);
      } else if (platform === "win32") {
        execSync(`start "" "${filePath}"`);
      }
    } catch {
      ctx.ui.notify(`Could not open browser. File: ${filePath}`, "warning");
    }
  }
}
