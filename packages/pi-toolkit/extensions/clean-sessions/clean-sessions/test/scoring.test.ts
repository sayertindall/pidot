/**
 * scoring.test.ts
 *
 * Unit tests for isAutoNamePattern and shouldExempt.
 */

import { describe, expect, it } from "vitest";
import { isAutoNamePattern, shouldExempt } from '../scoring';
import type { SessionCandidate } from '../types';

function makeCandidate(name: string | null): SessionCandidate {
	return {
		path: "/home/user/.pi/agent/sessions/test.jsonl",
		mtimeMs: Date.now(),
		sizeBytes: 100,
		lineCount: 5,
		name,
		ageDays: 45,
	};
}

describe("isAutoNamePattern", () => {
	it("returns false for null", () => {
		expect(isAutoNamePattern(null)).toBe(false);
	});

	it("returns true for names starting with YYYY-MM-DD", () => {
		expect(isAutoNamePattern("2026-01-15 some session")).toBe(true);
		expect(isAutoNamePattern("2025-12-31-uuid-here")).toBe(true);
		expect(isAutoNamePattern("2024-06-01")).toBe(true);
	});

	it("returns false for manually-chosen names", () => {
		expect(isAutoNamePattern("my notes")).toBe(false);
		expect(isAutoNamePattern("session-xyz")).toBe(false);
		expect(isAutoNamePattern("debugging auth")).toBe(false);
		expect(isAutoNamePattern("")).toBe(false);
	});

	it("returns false for names that look like dates but are incomplete", () => {
		expect(isAutoNamePattern("2026-1-15")).toBe(false); // single-digit month
		expect(isAutoNamePattern("26-01-15")).toBe(false); // two-digit year
	});
});

describe("shouldExempt", () => {
	it("returns false for unnamed sessions (null name)", () => {
		expect(shouldExempt(makeCandidate(null))).toBe(false);
	});

	it("returns false for auto-named sessions", () => {
		expect(shouldExempt(makeCandidate("2026-01-15 debug session"))).toBe(false);
	});

	it("returns true for manually-named sessions", () => {
		expect(shouldExempt(makeCandidate("auth debugging"))).toBe(true);
		expect(shouldExempt(makeCandidate("my-custom-name"))).toBe(true);
	});
});
