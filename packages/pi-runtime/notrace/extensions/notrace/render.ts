import type { SessionReport } from "./types.js";

function escapeHtml(v: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  };
  return v.replace(/[&<>'"]/g, c => map[c] ?? c);
}

function formatMs(ms: number): string {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(ts: number): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function typeClass(type: string): string {
  switch (type) {
    case "user": return "type-user";
    case "assistant": return "type-assistant";
    case "tool": return "type-tool";
    case "header": return "type-header";
    case "compaction": return "type-compaction";
    case "branch": return "type-branch";
    default: return "type-header";
  }
}

function renderSections(report: SessionReport): string {
  return report.sections
    .map(section => {
      const time = formatDate(section.timestamp);
      const typeClassed = typeClass(section.type);
      const body = escapeHtml(section.body);
      return `<div class="section">
  <div class="section-header">
    <span class="section-type ${typeClassed}">${escapeHtml(section.type)}</span>
    <span class="section-time">${time}</span>
  </div>
  <div class="section-body">${body}</div>
</div>`;
    })
    .join("\n");
}

function renderStats(report: SessionReport): string {
  const metrics = [
    { label: "User Messages", value: report.stats.userMessages },
    { label: "Assistant Turns", value: report.stats.assistantTurns },
    { label: "Tool Calls", value: report.stats.toolCalls },
    { label: "Files Touched", value: report.stats.filesTouched },
    { label: "Duration", value: formatMs(report.durationMs) },
    { label: "Model", value: report.model ?? "unknown" },
  ];
  return metrics
    .map(
      m =>
        `<div class="metric-card"><small>${escapeHtml(m.label)}</small><strong>${escapeHtml(String(m.value))}</strong></div>`,
    )
    .join("\n");
}

export function renderReport(report: SessionReport, template: string): string {
  return template
    .replace("{{title}}", escapeHtml(`Session ${report.sessionId.slice(0, 8)}`))
    .replace(
      "{{subtitle}}",
      escapeHtml(
        `${report.sessionId} · ${formatDate(report.startedAt)} · ${formatMs(report.durationMs)}`,
      ),
    )
    .replace("{{stats}}", renderStats(report))
    .replace("{{sections}}", renderSections(report))
    .replace(
      "{{footer}}",
      escapeHtml(
        `pi-runtime-notrace · ${report.sections.length} events · generated ${new Date().toISOString().slice(0, 19)}`,
      ),
    );
}
