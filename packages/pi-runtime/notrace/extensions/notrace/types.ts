export interface SessionReport {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  model: string | null;
  sections: ReportSection[];
  stats: {
    userMessages: number;
    assistantTurns: number;
    toolCalls: number;
    filesTouched: number;
  };
}

export interface ReportSection {
  type: "header" | "user" | "assistant" | "tool" | "compaction" | "branch";
  timestamp: number;
  title: string;
  body: string;
  meta?: Record<string, string>;
}
