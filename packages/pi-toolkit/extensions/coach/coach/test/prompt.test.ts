import { describe, expect, it } from "vitest";
import { COACH_SYSTEM_PROMPT, MAX_SESSIONS_DETAILED, buildCrossSessionOverlap, formatSessionDigest, buildAnalysisPrompt } from '../prompt';
import type { SessionDigest } from '../types';

describe("COACH_SYSTEM_PROMPT", () => {
	it("is non-empty", () => {
		expect(COACH_SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it("contains expected coaching categories", () => {
		expect(COACH_SYSTEM_PROMPT).toContain("PI Features You Should Coach On");
		expect(COACH_SYSTEM_PROMPT).toContain("/tree");
		expect(COACH_SYSTEM_PROMPT).toContain("/fork");
		expect(COACH_SYSTEM_PROMPT).toContain("/compact");
		expect(COACH_SYSTEM_PROMPT).toContain("Skills");
		expect(COACH_SYSTEM_PROMPT).toContain("Extensions");
		expect(COACH_SYSTEM_PROMPT).toContain("Prompt Templates");
	});

	it("contains analysis requirements", () => {
		expect(COACH_SYSTEM_PROMPT).toContain("Your Analysis Must Include");
		expect(COACH_SYSTEM_PROMPT).toContain("Specific missed opportunities");
		expect(COACH_SYSTEM_PROMPT).toContain("Cross-session inefficiencies");
		expect(COACH_SYSTEM_PROMPT).toContain("Prioritized recommendations");
	});
});

describe("MAX_SESSIONS_DETAILED", () => {
	it("is 15", () => {
		expect(MAX_SESSIONS_DETAILED).toBe(15);
	});
});

function makeDigest(overrides: Partial<SessionDigest> = {}): SessionDigest {
	return {
		name: undefined,
		created: "2025-01-01T00:00",
		entryCount: 10,
		branchPoints: 0,
		compactions: 0,
		labels: 0,
		isForked: false,
		userMessages: [],
		assistantSnippets: [],
		toolCalls: [],
		filesRead: [],
		filesEdited: [],
		...overrides,
	};
}

describe("formatSessionDigest", () => {
	it("includes session number and name", () => {
		const digest = makeDigest({ name: "my-session" });
		const output = formatSessionDigest(digest, 0);
		expect(output).toContain("Session 1:");
		expect(output).toContain('"my-session"');
	});

	it("handles unnamed sessions", () => {
		const digest = makeDigest();
		const output = formatSessionDigest(digest, 0);
		expect(output).toContain("(unnamed)");
	});

	it("includes user messages", () => {
		const digest = makeDigest({ userMessages: ["Hello", "Fix this bug"] });
		const output = formatSessionDigest(digest, 0);
		expect(output).toContain('"Hello"');
		expect(output).toContain('"Fix this bug"');
	});

	it("includes tool call summary", () => {
		const digest = makeDigest({
			toolCalls: [
				{ tool: "read" },
				{ tool: "read" },
				{ tool: "bash" },
			],
		});
		const output = formatSessionDigest(digest, 0);
		expect(output).toContain("read: 2");
		expect(output).toContain("bash: 1");
	});

	it("includes file access section", () => {
		const digest = makeDigest({
			filesRead: ["src/a"],
			filesEdited: ["src/b"],
		});
		const output = formatSessionDigest(digest, 0);
		expect(output).toContain("src/a");
		expect(output).toContain("src/b");
	});

	it("caps assistant snippets at 5", () => {
		const digest = makeDigest({
			assistantSnippets: ["a", "b", "c", "d", "e", "f", "g"],
		});
		const output = formatSessionDigest(digest, 0);
		// Should only have first 5 quoted snippets
		const quotes = (output.match(/"([a-g])"/g) ?? []).length;
		expect(quotes).toBeLessThanOrEqual(7); // up to 7 including user messages
	});
});

describe("buildCrossSessionOverlap", () => {
	it("finds files read across multiple sessions", () => {
		const digests = [
			makeDigest({ filesRead: ["a", "b"] }),
			makeDigest({ filesRead: ["a", "c"] }),
			makeDigest({ filesRead: ["a"] }),
		];
		const overlap = buildCrossSessionOverlap(digests);
		expect(overlap.readOverlap).toHaveLength(1);
		expect(overlap.readOverlap[0]!.file).toBe("a");
		expect(overlap.readOverlap[0]!.count).toBe(3);
	});

	it("finds files edited across multiple sessions", () => {
		const digests = [
			makeDigest({ filesEdited: ["x"] }),
			makeDigest({ filesEdited: ["x", "y"] }),
		];
		const overlap = buildCrossSessionOverlap(digests);
		expect(overlap.editOverlap).toHaveLength(1);
		expect(overlap.editOverlap[0]!.file).toBe("x");
		expect(overlap.editOverlap[0]!.count).toBe(2);
	});

	it("excludes files seen only once", () => {
		const digests = [
			makeDigest({ filesRead: ["unique"] }),
			makeDigest({ filesRead: ["other"] }),
		];
		const overlap = buildCrossSessionOverlap(digests);
		expect(overlap.readOverlap).toHaveLength(0);
	});

	it("returns empty arrays for single digest", () => {
		const digests = [makeDigest({ filesRead: ["a"], filesEdited: ["b"] })];
		const overlap = buildCrossSessionOverlap(digests);
		expect(overlap.readOverlap).toHaveLength(0);
		expect(overlap.editOverlap).toHaveLength(0);
	});
});

describe("buildAnalysisPrompt", () => {
	it("includes overview section", () => {
		const digests = [makeDigest({ userMessages: ["test"], toolCalls: [{ tool: "read" }] })];
		const prompt = buildAnalysisPrompt(digests, { readOverlap: [], editOverlap: [] }, digests[0]!, undefined, undefined, undefined);
		expect(prompt).toContain("PI Session Data for Analysis");
		expect(prompt).toContain("Overview");
		expect(prompt).toContain("Sessions analyzed: 1");
	});

	it("includes current session context when available", () => {
		const digests = [makeDigest()];
		const prompt = buildAnalysisPrompt(digests, { readOverlap: [], editOverlap: [] }, digests[0]!, 42.5, 42500, 100000);
		expect(prompt).toContain("Current Session Context");
		expect(prompt).toContain("42.5%");
	});

	it("omits current session context when undefined", () => {
		const digests = [makeDigest()];
		const prompt = buildAnalysisPrompt(digests, { readOverlap: [], editOverlap: [] }, digests[0]!, undefined, undefined, undefined);
		expect(prompt).not.toContain("Current Session Context");
	});

	it("includes overlap sections when present", () => {
		const digests = [makeDigest(), makeDigest()];
		const overlap = { readOverlap: [{ file: "a", count: 2 }], editOverlap: [] };
		const prompt = buildAnalysisPrompt(digests, overlap, digests[0]!, undefined, undefined, undefined);
		expect(prompt).toContain("Files Read Across Multiple Sessions");
		expect(prompt).toContain("a");
	});

	it("omits empty overlap sections", () => {
		const digests = [makeDigest()];
		const prompt = buildAnalysisPrompt(digests, { readOverlap: [], editOverlap: [] }, digests[0]!, undefined, undefined, undefined);
		expect(prompt).not.toContain("Files Read Across Multiple Sessions");
		expect(prompt).not.toContain("Files Edited Across Multiple Sessions");
	});

	it("caps detailed sessions at MAX_SESSIONS_DETAILED", () => {
		const digests = Array.from({ length: 20 }, (_, i) => makeDigest({ name: `session-${i}` }));
		const prompt = buildAnalysisPrompt(digests, { readOverlap: [], editOverlap: [] }, digests[0]!, undefined, undefined, undefined);
		expect(prompt).toContain("5 older sessions omitted for brevity");
		// Only first 15 are detailed
		expect(prompt).toContain("Session 15:");
		expect(prompt).not.toContain("Session 16:");
	});
});
