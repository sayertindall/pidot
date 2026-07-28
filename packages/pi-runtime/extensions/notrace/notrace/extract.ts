import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import type { ReportSection, SessionReport } from "./types.js";

interface JsonlEvent {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role: string;
    content: unknown;
  };
  modelId?: string;
  provider?: string;
  customType?: string;
  summary?: string;
}

function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n…[truncated]";
}

function formatToolCall(block: Record<string, unknown>): string {
  const name = String(block.name ?? "unknown");
  const args = block.args ?? block.input;
  const argsStr =
    typeof args === "string" ? args : JSON.stringify(args, null, 2);
  return `Tool: ${name}\nArgs:\n${truncate(argsStr, 2000)}`;
}

function formatToolResult(block: Record<string, unknown>): string {
  const id = String(block.toolCallId ?? block.tool_use_id ?? "unknown");
  const content = block.content ?? block.result ?? "";
  const contentStr =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return `Result (${id}):\n${truncate(contentStr, 2000)}`;
}

function formatContent(content: unknown): string {
  if (typeof content === "string") return truncate(content);
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .map(block => {
        if (!block || typeof block !== "object") return "";
        switch (block.type) {
          case "text":
            return truncate(String(block.text ?? ""));
          case "toolCall":
            return formatToolCall(block);
          case "toolResult":
          case "tool_result":
            return formatToolResult(block);
          case "thinking":
            return `[Thinking: ${truncate(String(block.thinking ?? block.text ?? ""), 1000)}]`;
          default:
            return `[${block.type ?? "unknown"}]: ${truncate(JSON.stringify(block, null, 2), 1000)}`;
        }
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return truncate(JSON.stringify(content, null, 2));
}

function formatMessageBody(msg: { role: string; content: unknown }): string {
  const role = msg.role;
  const content = formatContent(msg.content);
  if (!content) return `(${role})`;
  return content;
}

export async function buildReport(
  sessionFile: string,
  _ctx: ExtensionContext,
): Promise<SessionReport> {
  const raw = readFileSync(sessionFile, "utf-8");
  const lines = raw.split("\n").filter(l => l.trim().length > 0);

  let sessionId = "";
  let startedAt = 0;
  let endedAt = 0;
  let model: string | null = null;

  const sections: ReportSection[] = [];
  let userMessages = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let filesTouched = 0;

  const seenFiles = new Set<string>();

  for (const line of lines) {
    let event: JsonlEvent;
    try {
      event = JSON.parse(line) as JsonlEvent;
    } catch {
      continue;
    }

    const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;

    switch (event.type) {
      case "session": {
        sessionId = event.id ?? "";
        startedAt = ts;
        sections.push({
          type: "header",
          timestamp: ts,
          title: "Session Start",
          body: `Session: ${sessionId}`,
          meta: { sessionId },
        });
        break;
      }

      case "model_change": {
        model = event.modelId ?? null;
        sections.push({
          type: "header",
          timestamp: ts,
          title: "Model Change",
          body: `${event.provider ?? "?"} / ${event.modelId ?? "?"}`,
          meta: { provider: event.provider ?? "", model: event.modelId ?? "" },
        });
        break;
      }

      case "message": {
        const msg = event.message;
        if (!msg) break;
        endedAt = ts;

        switch (msg.role) {
          case "user": {
            userMessages++;
            sections.push({
              type: "user",
              timestamp: ts,
              title: "User",
              body: formatMessageBody(msg),
            });
            break;
          }

          case "assistant": {
            assistantTurns++;
            const body = formatMessageBody(msg);

            // Count tool calls in content blocks
            if (Array.isArray(msg.content)) {
              for (const block of msg.content as Array<Record<string, unknown>>) {
                if (block?.type === "toolCall") {
                  toolCalls++;
                }
              }
            }

            sections.push({
              type: "assistant",
              timestamp: ts,
              title: "Assistant",
              body,
            });
            break;
          }

          case "toolResult":
          case "tool_result": {
            const body = formatMessageBody(msg);
            sections.push({
              type: "tool",
              timestamp: ts,
              title: "Tool Result",
              body,
            });
            // Extract file paths from tool results for file count
            const bodyLower = body.toLowerCase();
            const pathMatches = bodyLower.match(/\/[^\s"'\n]+/g);
            if (pathMatches) {
              for (const p of pathMatches) {
                if (p.length > 2) seenFiles.add(p);
              }
            }
            break;
          }

          default:
            // Unknown role — still log it
            sections.push({
              type: "assistant",
              timestamp: ts,
              title: msg.role,
              body: formatMessageBody(msg),
            });
        }
        break;
      }

      case "compaction": {
        sections.push({
          type: "compaction",
          timestamp: ts,
          title: "Compaction",
          body: event.summary ?? "(no summary)",
        });
        break;
      }

      case "custom": {
        if (event.customType === "pi-checkpoint") {
          sections.push({
            type: "branch",
            timestamp: ts,
            title: "Checkpoint",
            body: JSON.stringify(event, null, 2),
          });
        }
        break;
      }

      default:
        // Skip unknown event types
        break;
    }
  }

  const durationMs = Math.max(0, endedAt - startedAt);
  filesTouched = seenFiles.size;

  return {
    sessionId,
    startedAt,
    endedAt,
    durationMs,
    model,
    sections,
    stats: {
      userMessages,
      assistantTurns,
      toolCalls,
      filesTouched,
    },
  };
}
