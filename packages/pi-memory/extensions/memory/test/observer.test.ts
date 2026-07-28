import { describe, expect, it, vi, beforeEach } from "vitest";

import { estimateStringTokens } from '../tokens.js';

// Mock createAgentSession — captures options, lets tests control behavior
let capturedOptions: any = null;
let promptHandler: ((tools: any[], userText: string) => Promise<void>) | null = null;

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: vi.fn(async (options: any) => {
		capturedOptions = options;
		const session = {
			prompt: async (text: string) => {
				if (promptHandler) {
					await promptHandler(options.customTools ?? [], text);
				}
			},
			abort: () => {},
			dispose: () => {},
		};
		return { session };
	}),
	DefaultResourceLoader: vi.fn(function(this: any, opts: any) { Object.assign(this, opts); this.reload = async () => {}; }),
	SessionManager: { inMemory: vi.fn(() => ({})) },
	getAgentDir: vi.fn(() => "/test/.pi/agent"),
}));

// Import after mock is set up
import { normalizeSourceEntryIds, OBSERVATION_TIMESTAMP_PATTERN, runObserver } from '../agents/observer/agent.js';

describe("OBSERVATION_TIMESTAMP_PATTERN", () => {
	it("matches local minute timestamps without regex shorthand escapes", () => {
		expect(OBSERVATION_TIMESTAMP_PATTERN).not.toContain("\\d");
		const pattern = new RegExp(OBSERVATION_TIMESTAMP_PATTERN);
		expect(pattern.test("2026-05-02 10:30")).toBe(true);
		expect(pattern.test("2026-5-02 10:30")).toBe(false);
		expect(pattern.test("2026-05-02T10:30")).toBe(false);
		expect(pattern.test("2026-05-02 10:30:00")).toBe(false);
	});
});

describe("runObserver", () => {
	const baseArgs = {
		model: {} as any,
		modelRegistry: {} as any,
		cwd: "/tmp",
		priorReflections: [] as string[],
		priorObservations: [] as string[],
		chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
		allowedSourceEntryIds: ["entry-a"],
	};

	beforeEach(() => {
		capturedOptions = null;
		promptHandler = null;
	});

	it("keeps core observer prompt rules", async () => {
		await runObserver({ ...baseArgs });

		const systemPrompt = capturedOptions?.resourceLoader?.systemPrompt ?? "";
		expect(systemPrompt).toContain("Preserve user assertions exactly");
		expect(systemPrompt).toContain("Detail preservation");
		expect(systemPrompt).toContain("Frame state changes as supersession");
		expect(systemPrompt).toContain("sourceEntryIds");
		expect(systemPrompt).toContain("zero observations");
		expect(systemPrompt).toContain("The dropper will drop these first");
		expect(systemPrompt).toContain("highest-resistance, load-bearing observations");
		expect(systemPrompt).not.toContain("will NEVER be dropped");
		expect(systemPrompt).not.toContain("pruner");
	});

	it("records V3 observations with source ids and code-computed tokenCount", async () => {
		const content = "User asked for a memory update.";
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				observations: [{ timestamp: "2026-05-02 10:30", content, relevance: "high", sourceEntryIds: ["entry-a"] }],
			});
		};

		const observations = await runObserver({ ...baseArgs });

		expect(observations).toHaveLength(1);
		expect(observations?.[0]).toMatchObject({
			content,
			timestamp: "2026-05-02 10:30",
			relevance: "high",
			sourceEntryIds: ["entry-a"],
			tokenCount: estimateStringTokens(content),
		});
		expect(observations?.[0]?.id).toMatch(/^[a-f0-9]{12}$/);
	});

	it("rejects invented source ids and returns no observations", async () => {
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				observations: [{ timestamp: "2026-05-02 10:30", content: "Bad source", relevance: "medium", sourceEntryIds: ["missing"] }],
			});
		};

		await expect(runObserver({ ...baseArgs })).resolves.toBeUndefined();
	});

	it("dedupes deterministic ids", async () => {
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				observations: [
					{ timestamp: "2026-05-02 10:30", content: "Same content", relevance: "medium", sourceEntryIds: ["entry-a"] },
					{ timestamp: "2026-05-02 10:31", content: "Same content", relevance: "high", sourceEntryIds: ["entry-a"] },
				],
			});
		};

		const observations = await runObserver({ ...baseArgs });

		expect(observations).toHaveLength(1);
		expect(observations?.[0]?.content).toBe("Same content");
	});

	it("returns undefined when no tool call records observations", async () => {
		promptHandler = async () => {};
		await expect(runObserver({ ...baseArgs })).resolves.toBeUndefined();
	});

	it("passes thinkingLevel to session for reasoning models", async () => {
		await runObserver({ ...baseArgs, model: { reasoning: true } as any, thinkingLevel: "minimal" });

		expect(capturedOptions?.thinkingLevel).toBe("minimal");
	});

	it("omits thinkingLevel when set to off", async () => {
		await runObserver({ ...baseArgs, model: { reasoning: true } as any, thinkingLevel: "off" });

		expect(capturedOptions?.thinkingLevel).toBeUndefined();
	});
});

describe("normalizeSourceEntryIds", () => {
	const allowed = ["entry-a", "entry-b", "entry-c"];

	it("accepts source ids from the allowed chunk and orders them by branch order", () => {
		expect(normalizeSourceEntryIds(["entry-c", "entry-a"], allowed)).toEqual(["entry-a", "entry-c"]);
	});

	it("dedupes repeated source ids", () => {
		expect(normalizeSourceEntryIds(["entry-b", "entry-b", "entry-a"], allowed)).toEqual(["entry-a", "entry-b"]);
	});

	it("rejects missing, empty, or hallucinated source ids", () => {
		expect(normalizeSourceEntryIds(undefined, allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds([], allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds(["entry-a", "not-in-the-chunk"], allowed)).toBeUndefined();
		expect(normalizeSourceEntryIds(["entry-a"], [])).toBeUndefined();
	});
});
