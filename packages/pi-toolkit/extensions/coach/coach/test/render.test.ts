import { describe, expect, it } from "vitest";
import { formatCoachingReport, reportHeader, reportFooter } from '../render';

describe("formatCoachingReport", () => {
	it("returns a SavedCoachReport with all fields", () => {
		const report = formatCoachingReport("current", 1, "# Analysis\n\nGreat work!", "test-model", "2025-01-15T10:30:00Z");
		expect(report.scope).toBe("current");
		expect(report.markdown).toBe("# Analysis\n\nGreat work!");
		expect(report.createdAt).toBe("2025-01-15T10:30:00Z");
	});

	it("handles 'all' scope", () => {
		const report = formatCoachingReport("all", 5, "# Multi-session", "test-model", "2025-01-15T10:30:00Z");
		expect(report.scope).toBe("all");
	});
});

describe("reportHeader", () => {
	it("includes scope for current session", () => {
		const header = reportHeader("current", 1, "test-model");
		expect(header).toContain("Current session");
		expect(header).toContain("test-model");
	});

	it("includes session count for all scope", () => {
		const header = reportHeader("all", 5, "test-model");
		expect(header).toContain("5 analyzed");
	});
});

describe("reportFooter", () => {
	it("lists source paths", () => {
		const footer = reportFooter(["/path/a.jsonl", "/path/b.jsonl"]);
		expect(footer).toContain("/path/a.jsonl");
		expect(footer).toContain("/path/b.jsonl");
		expect(footer).toContain("Analysis Sources");
	});

	it("handles empty paths", () => {
		const footer = reportFooter([]);
		expect(footer).toContain("Analysis Sources");
	});
});
