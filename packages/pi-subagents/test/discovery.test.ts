import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, loadCustomAgents, parseExtSelectors } from "../extensions/subagents/discovery.ts";

describe("parseExtSelectors", () => {
	it("a bare ext:name selector keeps all of that extension's tools, no narrowing", () => {
		const { extNames, narrowing } = parseExtSelectors(["ext:mcp"]);
		expect(extNames.has("mcp")).toBe(true);
		expect(narrowing.has("mcp")).toBe(false);
	});

	it("ext:name/tool narrows that extension to just the named tool", () => {
		const { extNames, narrowing } = parseExtSelectors(["ext:mcp/fetch"]);
		expect(extNames.has("mcp")).toBe(true);
		expect(narrowing.get("mcp")).toEqual(new Set(["fetch"]));
	});

	it("multiple narrowed tools for the same extension accumulate", () => {
		const { narrowing } = parseExtSelectors(["ext:mcp/fetch", "ext:mcp/search"]);
		expect(narrowing.get("mcp")).toEqual(new Set(["fetch", "search"]));
	});

	it("extension names are lowercased; tool names are case-preserved", () => {
		const { extNames, narrowing } = parseExtSelectors(["ext:MCP/Fetch"]);
		expect(extNames.has("mcp")).toBe(true);
		expect(narrowing.get("mcp")).toEqual(new Set(["Fetch"]));
	});

	it("empty input yields empty sets/maps", () => {
		const { extNames, narrowing } = parseExtSelectors([]);
		expect(extNames.size).toBe(0);
		expect(narrowing.size).toBe(0);
	});
});

describe("DEFAULT_AGENTS", () => {
	it("has exactly the three embedded defaults", () => {
		expect([...DEFAULT_AGENTS.keys()].sort()).toEqual(["Explore", "Plan", "general-purpose"].sort());
	});

	it("Explore and Plan are read-only (no write/edit in their builtin tool list)", () => {
		expect(DEFAULT_AGENTS.get("Explore")?.builtinToolNames).not.toContain("write");
		expect(DEFAULT_AGENTS.get("Plan")?.builtinToolNames).not.toContain("edit");
	});
});

describe("loadCustomAgents", () => {
	let cwd: string;
	let globalDir: string;
	const originalEnv = process.env.PI_CODING_AGENT_DIR;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-cwd-"));
		globalDir = mkdtempSync(join(tmpdir(), "pi-subagents-discovery-global-"));
		process.env.PI_CODING_AGENT_DIR = globalDir;
	});

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalEnv;
	});

	function writeAgent(dir: string, filename: string, content: string): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, filename), content);
	}

	it("loads a project-level agent from .pi/agents", () => {
		writeAgent(
			join(cwd, ".pi", "agents"),
			"reviewer.md",
			"---\ndescription: Reviews code\ntools: read, grep\n---\nYou review code.",
		);
		const agents = loadCustomAgents(cwd);
		const reviewer = agents.get("reviewer");
		expect(reviewer).toBeDefined();
		expect(reviewer?.description).toBe("Reviews code");
		expect(reviewer?.builtinToolNames).toEqual(["read", "grep"]);
		expect(reviewer?.systemPrompt).toBe("You review code.");
	});

	it("project-level .pi/agents overrides a same-named global agent", () => {
		writeAgent(join(globalDir, "agents"), "helper.md", "---\ndescription: Global version\n---\nGlobal prompt.");
		writeAgent(join(cwd, ".pi", "agents"), "helper.md", "---\ndescription: Project version\n---\nProject prompt.");

		const agents = loadCustomAgents(cwd);
		expect(agents.get("helper")?.description).toBe("Project version");
	});

	it("project-level .pi/agents overrides the shared .agents/agents workspace location", () => {
		writeAgent(join(cwd, ".agents", "agents"), "helper.md", "---\ndescription: Workspace version\n---\nWorkspace prompt.");
		writeAgent(join(cwd, ".pi", "agents"), "helper.md", "---\ndescription: Project version\n---\nProject prompt.");

		const agents = loadCustomAgents(cwd);
		expect(agents.get("helper")?.description).toBe("Project version");
	});

	it("tools: with an ext: selector partitions builtins from ext selectors", () => {
		writeAgent(
			join(cwd, ".pi", "agents"),
			"fetcher.md",
			"---\ndescription: Fetches things\ntools: read, ext:mcp/fetch\n---\nFetch stuff.",
		);
		const fetcher = loadCustomAgents(cwd).get("fetcher");
		expect(fetcher?.builtinToolNames).toEqual(["read"]);
		expect(fetcher?.extSelectors).toEqual(["ext:mcp/fetch"]);
	});

	it("extensions: false disables extension inheritance", () => {
		writeAgent(join(cwd, ".pi", "agents"), "sealed.md", "---\ndescription: Sealed\nextensions: none\n---\nSealed.");
		expect(loadCustomAgents(cwd).get("sealed")?.extensions).toBe(false);
	});

	it("omitted extensions:/skills: default to true (inherit all)", () => {
		writeAgent(join(cwd, ".pi", "agents"), "plain.md", "---\ndescription: Plain\n---\nPlain.");
		const plain = loadCustomAgents(cwd).get("plain");
		expect(plain?.extensions).toBe(true);
		expect(plain?.skills).toBe(true);
	});

	it("[FIX] throws on a filename-derived name that fails ^[a-z][a-z0-9-]*$", () => {
		writeAgent(join(cwd, ".pi", "agents"), "Bad Name.md", "---\ndescription: Bad\n---\nBad.");
		expect(() => loadCustomAgents(cwd)).toThrow(/Invalid agent name/);
	});

	it("accepts a valid lowercase-hyphenated name", () => {
		writeAgent(join(cwd, ".pi", "agents"), "code-reviewer.md", "---\ndescription: ok\n---\nok.");
		expect(loadCustomAgents(cwd).has("code-reviewer")).toBe(true);
	});
});
