import type { CoachScope, SavedCoachReport } from "./types";

export function formatCoachingReport(
	scope: CoachScope,
	_sessionsAnalyzed: number,
	markdown: string,
	_model: string,
	createdAt: string,
): SavedCoachReport {
	return {
		markdown,
		scope,
		createdAt,
	};
}

export function reportHeader(scope: CoachScope, sessionsAnalyzed: number, model: string): string {
	const lines: string[] = [];
	lines.push(`# Coach Analysis`);
	lines.push("");
	lines.push(`**Scope:** ${scope === "current" ? "Current session" : `All sessions (${sessionsAnalyzed} analyzed)`}`);
	lines.push(`**Model:** ${model}`);
	lines.push("");
	return lines.join("\n");
}

export function reportFooter(digestPaths: string[]): string {
	const lines: string[] = [];
	lines.push("");
	lines.push("---");
	lines.push("");
	lines.push("### Analysis Sources");
	for (const path of digestPaths) {
		lines.push(`- \`${path}\``);
	}
	return lines.join("\n");
}
