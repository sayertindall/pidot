import { describe, expect, it, vi, beforeEach } from "vitest";

import {
	normalizeSupportingObservationIds,
	observationToReflectorLine,
	summarizeSupportIdCounts,
} from '../agents/reflector/agent.js';
import { hashId } from '../ids.js';
import { estimateStringTokens } from '../tokens.js';
import { observation, reflection } from "./fixtures/session.js";

// Mock createAgentSession
let capturedOptions: any = null;
let promptHandler: ((tools: any[], userText: string) => Promise<void>) | null = null;

vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: vi.fn(async (options: any) => {
		capturedOptions = options;
		const session = {
			prompt: async (text: string) => {
				if (promptHandler) await promptHandler(options.customTools ?? [], text);
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

import { runReflector } from '../agents/reflector/agent.js';

describe("V3 reflector agent", () => {
	const obsA = observation("aaaaaaaaaaaa");
	const obsB = observation("bbbbbbbbbbbb");
	const baseArgs = {
		model: {} as any,
		modelRegistry: {} as any,
		cwd: "/tmp",
		reflections: [] as any[],
		observations: [obsA, obsB],
	};

	beforeEach(() => {
		capturedOptions = null;
		promptHandler = null;
	});

	it("keeps core reflector prompt guidance in V3 terms", async () => {
		await runReflector({ ...baseArgs });
		const systemPrompt = capturedOptions?.resourceLoader?.systemPrompt ?? "";

		expect(systemPrompt).toContain("Your task is different from the observer");
		expect(systemPrompt).toContain("User assertions are authoritative");
		expect(systemPrompt).toContain("supportingObservationIds");
		expect(systemPrompt).toContain("coverage/provenance set");
		expect(systemPrompt).toContain("Do not lightly reword existing reflections");
		expect(systemPrompt).toContain("Reflections are scarce, expensive durable orientation anchors");
		expect(systemPrompt).toContain("not a second observation layer");
		expect(systemPrompt).toContain("Over-reflection is also memory distortion");
		expect(systemPrompt).toContain("makes transient details look durable");
		expect(systemPrompt).toContain("Decision procedure:");
		expect(systemPrompt).toContain("future-agent utility test");
		expect(systemPrompt).toContain("avoid a wrong decision, repeated work, or user-preference violation");
		expect(systemPrompt).toContain("If the candidate fails that future-agent utility test, leave it as an observation");
		expect(systemPrompt).toContain("If unsure, emit no reflection");
		expect(systemPrompt).toContain("better to emit zero reflections than to create one reflection per observation");
		expect(systemPrompt).toContain("Prefer fewer, higher-value reflections");
		expect(systemPrompt).toContain("Most transient task-log observations");
		expect(systemPrompt).toContain("[coverage: none|partial|strong]");
		expect(systemPrompt).toContain("Coverage tiers are review context");
		expect(systemPrompt).toContain("supportingObservationIds are not a checklist");
		expect(systemPrompt).not.toContain("legacy/no-provenance");
		expect(systemPrompt).not.toContain("pruner");
		expect(systemPrompt).not.toContain("Pass strategy");
	});

	it("renders coverage tiers in every active observation line for the reflector", async () => {
		const none = observation("aaaaaaaaaaaa", { content: "Uncovered durable fact" });
		const partial = observation("bbbbbbbbbbbb", { content: "Partially covered fact" });
		const strong = observation("cccccccccccc", { content: "Strongly covered fact" });
		let userText = "";
		promptHandler = async (_tools, text) => { userText = text; };

		await runReflector({
			...baseArgs,
			observations: [none, partial, strong],
			reflections: [
				reflection("rrrrrrrrrrr1", ["bbbbbbbbbbbb", "cccccccccccc"]),
				reflection("rrrrrrrrrrr2", ["cccccccccccc"]),
			],
		});

		expect(userText).toContain("[aaaaaaaaaaaa]");
		expect(userText).toContain("[coverage: none] Uncovered durable fact");
		expect(userText).toContain("[coverage: partial] Partially covered fact");
		expect(userText).toContain("[coverage: strong] Strongly covered fact");
		expect(userText).not.toContain("drop-priority");
		expect(userText).not.toContain("drop-resistance");
	});

	it("renders reflector observation lines with coverage evidence only", () => {
		const line = observationToReflectorLine(
			observation("aaaaaaaaaaaa", { relevance: "critical", content: "Important reflected fact" }),
			"partial",
		);
		expect(line).toContain("[aaaaaaaaaaaa]");
		expect(line).toContain("[critical]");
		expect(line).toContain("[coverage: partial]");
		expect(line).toContain("Important reflected fact");
		expect(line).not.toContain("drop-priority");
		expect(line).not.toContain("drop-resistance");
	});

	it("summarizes accepted reflection support-id counts without exposing ids", () => {
		expect(summarizeSupportIdCounts([])).toEqual({
			reflectionCount: 0, totalSupportIds: 0, minSupportIds: 0, maxSupportIds: 0, averageSupportIds: 0, histogram: {},
		});
		expect(summarizeSupportIdCounts([
			reflection("rrrrrrrrrrr1", ["aaaaaaaaaaaa"]),
			reflection("rrrrrrrrrrr2", ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"]),
		])).toEqual({
			reflectionCount: 2, totalSupportIds: 4, minSupportIds: 1, maxSupportIds: 3, averageSupportIds: 2, histogram: { "1": 1, "3": 1 },
		});
	});

	it("normalizes supporting observation ids by active observation order", () => {
		expect(normalizeSupportingObservationIds(["bbbbbbbbbbbb", "aaaaaaaaaaaa", "aaaaaaaaaaaa"], ["aaaaaaaaaaaa", "bbbbbbbbbbbb"])).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
		expect(normalizeSupportingObservationIds(["aaaaaaaaaaaa", "missing"], ["aaaaaaaaaaaa"])).toBeUndefined();
		expect(normalizeSupportingObservationIds([], ["aaaaaaaaaaaa"])).toBeUndefined();
	});

	it("records one-line V3 reflections with code-computed ids and token counts", async () => {
		const content = "User prefers source-backed memory.";
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				reflections: [{ content, supportingObservationIds: ["bbbbbbbbbbbb", "aaaaaaaaaaaa"] }],
			});
		};
		const result = await runReflector({ ...baseArgs });
		expect(result).toEqual([{ id: hashId(content), content, supportingObservationIds: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], tokenCount: estimateStringTokens(content) }]);
	});

	it("rejects invented support ids and multiline content", async () => {
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				reflections: [
					{ content: "Bad support", supportingObservationIds: ["missing"] },
					{ content: "Two\nlines", supportingObservationIds: ["aaaaaaaaaaaa"] },
				],
			});
		};
		await expect(runReflector({ ...baseArgs })).resolves.toBeUndefined();
	});

	it("dedupes proposals and skips existing reflection ids", async () => {
		const content = "User prefers terse updates.";
		const existing = reflection(hashId(content), ["aaaaaaaaaaaa"], { content });
		promptHandler = async (tools) => {
			await tools[0].execute("tool-1", {
				reflections: [
					{ content, supportingObservationIds: ["aaaaaaaaaaaa"] },
					{ content: "New durable fact.", supportingObservationIds: ["aaaaaaaaaaaa"] },
					{ content: "New durable fact.", supportingObservationIds: ["bbbbbbbbbbbb"] },
				],
			});
		};
		const result = await runReflector({ ...baseArgs, reflections: [existing] });
		expect(result?.map((item) => item.content)).toEqual(["New durable fact."]);
	});

	it("returns undefined when no tool call records reflections", async () => {
		promptHandler = async () => {};
		await expect(runReflector({ ...baseArgs })).resolves.toBeUndefined();
	});
});
