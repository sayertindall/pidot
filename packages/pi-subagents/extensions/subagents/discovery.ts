/**
 * discovery.ts — Agent definition parsing (Markdown + frontmatter) and the
 * `tools:` scoping grammar it feeds. See SUB-SPEC-v4.md §2.2.
 *
 * Ported from the reference (`tintinweb/pi-subagents`):
 *  - `loadCustomAgents` + field parsers: src/custom-agents.ts
 *  - `parseExtSelectors` + `installExtensionToolScope` (+ their
 *    `extensionCanonicalName(s)` dependency): src/agent-runner.ts
 *  - `BUILTIN_TOOL_NAMES`: src/agent-types.ts
 *  - `DEFAULT_AGENTS`: src/default-agents.ts
 *
 * One deliberate deviation from the reference **[FIX]**: after an agent's
 * `name` is derived from its filename, it is validated against
 * `AgentFrontmatterSchema`'s `name` pattern (`^[a-z][a-z0-9-]*$`) via
 * `Value.Check`/`Value.Errors`. The reference silently accepts any
 * filename-derived name (including ones that could never be typed as a
 * `subagent_type` argument); this spec rejects a malformed one loudly
 * (throws) instead of letting it become a silently-unreachable agent type.
 * This gate applies only to file-derived names — the three embedded
 * defaults (`general-purpose`, `Explore`, `Plan`, from `DEFAULT_AGENT_NAMES`)
 * are code, not user frontmatter, and are exempt.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentSession, AgentSessionEvent, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createCodingTools, createReadOnlyTools, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { AgentFrontmatterSchema } from "./schema.ts";
import type { AgentConfig, MemoryScope, ThinkingLevel } from "./types.ts";
import { DEFAULT_AGENT_NAMES, EXCLUDED_TOOL_NAMES } from "./types.ts";

// ---- Built-in tool names ----

/**
 * All known built-in tool names, derived from pi's own tool factories rather
 * than hardcoded so the set tracks pi-mono if it adds/renames a built-in.
 * `createCodingTools` → read/bash/edit/write; `createReadOnlyTools` →
 * read/grep/find/ls; their de-duplicated union is the 7 built-ins
 * (read, bash, edit, write, grep, find, ls). The `cwd` only binds tool
 * operations we never invoke here — we read each tool's `.name` and discard it.
 */
export const BUILTIN_TOOL_NAMES: string[] = [
	...new Set([...createCodingTools("."), ...createReadOnlyTools(".")].map((t) => t.name)),
];

// SUBAGENT_TOOL_NAMES / EXCLUDED_TOOL_NAMES live in types.ts (imported above) --
// session-runner.ts and index.ts need them too, so the single source of truth
// has to be a leaf module neither of those would create a cycle importing.

// ---- Default agents ----

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];

const [GENERAL_PURPOSE, EXPLORE, PLAN] = DEFAULT_AGENT_NAMES;

/** The three embedded default agents, always available regardless of project config. */
export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map([
	[
		GENERAL_PURPOSE,
		{
			name: GENERAL_PURPOSE,
			displayName: "Agent",
			description:
				"General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
			// builtinToolNames omitted — means "all available tools" (resolved at lookup time)
			// inheritContext / runInBackground / isolated omitted — strategy fields, callers decide per-call.
			extensions: true,
			skills: true,
			systemPrompt: "",
			promptMode: "append",
			isDefault: true,
		},
	],
	[
		EXPLORE,
		{
			name: EXPLORE,
			displayName: "Explore",
			description:
				'Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions.',
			builtinToolNames: READ_ONLY_TOOLS,
			extensions: true,
			skills: true,
			// Fast/cheap model for read-only search. Provider-preferred but resilient:
			// resolveModel matches this fuzzily (date-stamp optional) and falls back to
			// the same model under another provider if anthropic doesn't expose it.
			model: "anthropic/claude-haiku-4-5",
			systemPrompt: `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.
Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail.

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations
- Make independent tool calls in parallel for efficiency
- Adapt search approach based on thoroughness level specified

# Output
- Use absolute file paths in all references
- Report findings as regular messages
- Do not use emojis
- Be thorough and precise`,
			promptMode: "replace",
			isDefault: true,
		},
	],
	[
		PLAN,
		{
			name: PLAN,
			displayName: "Plan",
			description:
				"Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
			builtinToolNames: READ_ONLY_TOOLS,
			extensions: true,
			skills: true,
			systemPrompt: `# CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS
You are a software architect and planning specialist.
Your role is EXCLUSIVELY to explore the codebase and design implementation plans.
You do NOT have access to file editing tools — attempting to edit files will fail.

You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Deleting files
- Moving or copying files
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

# Planning Process
1. Understand requirements
2. Explore thoroughly (read files, find patterns, understand architecture)
3. Design solution based on your assigned perspective
4. Detail the plan with step-by-step implementation strategy

# Requirements
- Consider trade-offs and architectural decisions
- Identify dependencies and sequencing
- Anticipate potential challenges
- Follow existing patterns where appropriate

# Tool Usage
- Use the find tool for file pattern matching (NOT the bash find command)
- Use the grep tool for content search (NOT bash grep/rg command)
- Use the read tool for reading files (NOT bash cat/head/tail)
- Use Bash ONLY for read-only operations

# Output Format
- Use absolute file paths
- Do not use emojis
- End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- /absolute/path/to/file.ts - [Brief reason]`,
			promptMode: "replace",
			isDefault: true,
		},
	],
]);

// ---- Agent definition discovery (loadCustomAgents) ----

/**
 * Scan for custom agent .md files from multiple locations.
 * Discovery hierarchy (higher priority wins):
 *   1. Project:   <cwd>/.pi/agents/*.md (authoritative — also where /agents writes)
 *   2. Workspace: <cwd>/.agents/agents/*.md (shared cross-tool .agents workspace, read-only)
 *   3. Global:    $PI_CODING_AGENT_DIR/agents/*.md (default: ~/.pi/agent/agents/*.md)
 *
 * Project-level agents override global ones with the same name. On a name clash
 * between the two project locations, .pi/agents wins — .pi stays the project
 * authority; .agents/agents is an additional read location.
 * Any name is allowed — names matching defaults (e.g. "Explore") override them,
 * provided the name also survives the `[FIX]` validation below (which means an
 * override of an upper-cased default name must itself be a valid lowercase
 * `^[a-z][a-z0-9-]*$` filename — this spec has no case-insensitive escape hatch
 * for that, unlike the reference).
 */
export function loadCustomAgents(cwd: string): Map<string, AgentConfig> {
	const globalDir = join(getAgentDir(), "agents");
	const workspaceProjectDir = join(cwd, ".agents", "agents");
	const projectDir = join(cwd, ".pi", "agents");

	const agents = new Map<string, AgentConfig>();
	loadFromDir(globalDir, agents, "global"); // lowest priority
	loadFromDir(workspaceProjectDir, agents, "project"); // shared workspace
	loadFromDir(projectDir, agents, "project"); // highest priority (overwrites)
	return agents;
}

/** Just the `name` subschema of AgentFrontmatterSchema — reused so the pattern lives in one place. */
const AGENT_NAME_SCHEMA = AgentFrontmatterSchema.properties.name;

/**
 * `[FIX]` Validate a file-derived agent name against `AgentFrontmatterSchema`'s
 * `^[a-z][a-z0-9-]*$` pattern. Throws loudly on mismatch instead of letting a
 * malformed name (e.g. from a filename with spaces, uppercase, or leading
 * digits) silently become an agent type nothing can ever address by name.
 */
function validateAgentName(name: string, filePath: string): void {
	if (Value.Check(AGENT_NAME_SCHEMA, name)) return;
	const details = [...Value.Errors(AGENT_NAME_SCHEMA, name)]
		.map((e) => e.message)
		.join("; ") || "does not match ^[a-z][a-z0-9-]*$";
	throw new Error(`Invalid agent name "${name}" (from ${filePath}): ${details}`);
}

/** Load agent configs from a directory into the map. */
function loadFromDir(dir: string, agents: Map<string, AgentConfig>, source: "project" | "global"): void {
	if (!existsSync(dir)) return;

	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return;
	}

	for (const file of files) {
		const name = basename(file, ".md");
		const filePath = join(dir, file);

		validateAgentName(name, filePath);

		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(content);

		const { builtinToolNames, extSelectors } = parseToolsField(fm.tools);

		agents.set(name, {
			name,
			displayName: str(fm.display_name),
			description: str(fm.description) ?? name,
			builtinToolNames,
			extSelectors,
			disallowedTools: csvListOptional(fm.disallowed_tools),
			extensions: inheritField(fm.extensions ?? fm.inherit_extensions),
			excludeExtensions: csvListOptional(fm.exclude_extensions),
			skills: inheritField(fm.skills ?? fm.inherit_skills),
			model: str(fm.model),
			thinking: str(fm.thinking) as ThinkingLevel | undefined,
			maxTurns: nonNegativeInt(fm.max_turns),
			persistSession: fm.persist_session != null ? fm.persist_session === true : undefined,
			sessionDir: str(fm.session_dir),
			systemPrompt: body.trim(),
			promptMode: fm.prompt_mode === "append" ? "append" : "replace",
			inheritContext: fm.inherit_context != null ? fm.inherit_context === true : undefined,
			runInBackground: fm.run_in_background != null ? fm.run_in_background === true : undefined,
			isolated: fm.isolated != null ? fm.isolated === true : undefined,
			memory: parseMemory(fm.memory),
			isolation: fm.isolation === "worktree" ? "worktree" : undefined,
			enabled: fm.enabled !== false, // default true; explicitly false disables
			source,
		});
	}
}

// ---- Field parsers ----
// All follow the same convention: omitted → default, "none"/empty → nothing, value → exact.

/** Extract a string or undefined. */
function str(val: unknown): string | undefined {
	return typeof val === "string" ? val : undefined;
}

/** Extract a non-negative integer or undefined. 0 means unlimited for max_turns. */
function nonNegativeInt(val: unknown): number | undefined {
	return typeof val === "number" && val >= 0 ? val : undefined;
}

/**
 * Parse a raw CSV field value into items, or undefined if absent/empty/"none".
 */
function parseCsvField(val: unknown): string[] | undefined {
	if (val === undefined || val === null) return undefined;
	const s = String(val).trim();
	if (!s || s === "none") return undefined;
	const items = s.split(",").map((t) => t.trim()).filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/**
 * Parse a comma-separated list field with defaults.
 * omitted → defaults; "none"/empty → []; csv → listed items.
 */
function csvList(val: unknown, defaults: string[]): string[] {
	if (val === undefined || val === null) return defaults;
	return parseCsvField(val) ?? [];
}

/**
 * Partition the `tools:` CSV into the built-in tool allowlist and raw `ext:` selectors.
 * `*` (and the case-insensitive alias `all`, for `tools: all`) expands to all
 * built-ins; plain entries are built-in names; `ext:` entries are extension-tool
 * selectors parsed later by `parseExtSelectors`. omitted → all built-ins, no selectors.
 * `tools:` present with only `ext:` entries → zero built-ins (use `*`).
 */
function parseToolsField(val: unknown): { builtinToolNames: string[]; extSelectors: string[] | undefined } {
	const entries = csvList(val, BUILTIN_TOOL_NAMES);
	const isWildcard = (e: string) => e === "*" || e.toLowerCase() === "all";
	const hasWildcard = entries.some(isWildcard);
	const plain = entries.filter((e) => !isWildcard(e) && !e.startsWith("ext:"));
	const extEntries = entries.filter((e) => e.startsWith("ext:"));
	return {
		builtinToolNames: hasWildcard ? [...new Set([...BUILTIN_TOOL_NAMES, ...plain])] : plain,
		extSelectors: extEntries.length > 0 ? extEntries : undefined,
	};
}

/**
 * Parse an optional comma-separated list field.
 * omitted → undefined; "none"/empty → undefined; csv → listed items.
 */
function csvListOptional(val: unknown): string[] | undefined {
	return parseCsvField(val);
}

/**
 * Parse a memory scope field.
 * omitted → undefined; "user"/"project"/"local" → MemoryScope.
 */
function parseMemory(val: unknown): MemoryScope | undefined {
	if (val === "user" || val === "project" || val === "local") return val;
	return undefined;
}

/**
 * Parse an inherit field (extensions, skills).
 * omitted/true → true (inherit all); false/"none"/empty → false; csv → listed names.
 */
function inheritField(val: unknown): true | string[] | false {
	if (val === undefined || val === null || val === true) return true;
	if (val === false || val === "none") return false;
	const items = csvList(val, []);
	return items.length > 0 ? items : false;
}

// ---- Extension canonical-name resolution ----
// Ported from agent-runner.ts (lines 51-119 in the reference) — a dependency
// of installExtensionToolScope's inScope() below, not part of the reference's
// "lines 160-260" excerpt, but required for that function to actually compile
// and behave correctly.

/**
 * Canonical name of an extension for `extensions: [...]` allowlist matching.
 * Lowercased — extension names match case-insensitively so `extensions: [Mcp]`
 * resolves the same as `[mcp]`. Tool names within `ext:foo/bar` are not affected.
 * Directory extensions (`foo/index.ts`) resolve to the parent directory name;
 * single-file extensions to the basename minus `.ts`/`.js`.
 */
function extensionCanonicalName(extPath: string): string {
	const base = basename(extPath);
	const name = base === "index.ts" || base === "index.js" ? basename(dirname(extPath)) : base.replace(/\.(ts|js)$/, "");
	return name.toLowerCase();
}

/**
 * The unscoped, lowercased npm short name of the pi package that DECLARES
 * `extPath` as an extension entry — or undefined if the entry doesn't belong to
 * such a package. Climbs from the entry's directory looking for the owning
 * package, stopping at the first `package.json` (the package root) or at a
 * `node_modules` boundary (a package never spans one). The name is used only
 * when that root's `pi.extensions` manifest actually lists this entry.
 */
function extensionPackageName(extPath: string): string | undefined {
	const entry = resolve(extPath);
	let dir = dirname(extPath);
	for (;;) {
		// Climbing into node_modules means we've left the owning package's tree.
		if (basename(dir) === "node_modules") return undefined;
		let pkg: { name?: unknown; pi?: { extensions?: unknown } };
		try {
			pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return undefined; // walked to the filesystem root
			dir = parent;
			continue;
		}
		// First package.json wins — it's the package root; decide here.
		const entries = pkg.pi?.extensions;
		if (
			typeof pkg.name === "string" &&
			Array.isArray(entries) &&
			entries.some((e) => typeof e === "string" && resolve(dir, e) === entry)
		) {
			const short = pkg.name.startsWith("@") ? pkg.name.slice(pkg.name.indexOf("/") + 1) : pkg.name;
			return short.toLowerCase();
		}
		return undefined;
	}
}

/**
 * All names an extension answers to for allowlist matching (lowercased): its
 * path-derived {@link extensionCanonicalName} plus, when a pi package manifest
 * declares this entry, that package's unscoped short name (`@scope/foo` → `foo`).
 */
function extensionCanonicalNames(extPath: string): string[] {
	const canonical = extensionCanonicalName(extPath);
	const pkg = extensionPackageName(extPath);
	return pkg && pkg !== canonical ? [canonical, pkg] : [canonical];
}

// ---- `ext:` selector grammar + tool-scope enforcement ----

/**
 * Parse raw `ext:` selector strings (from the `tools:` CSV) into the set of
 * extension names to keep loaded and a per-extension tool-narrowing map.
 *
 * `ext:foo` → `extNames` has `foo`, no narrowing entry (all of foo's tools).
 * `ext:foo/bar` → `extNames` has `foo`, `narrowing.foo` has `bar` (only `bar`).
 * A name lands in `narrowing` only when a `/tool` form is seen, so a bare
 * `ext:foo` alongside `ext:foo/bar` leaves narrowing in effect (narrowing wins).
 * The split is on the first `/`; extension canonical names never contain `/`.
 */
export function parseExtSelectors(entries: string[]): {
	extNames: Set<string>;
	narrowing: Map<string, Set<string>>;
} {
	const extNames = new Set<string>();
	const narrowing = new Map<string, Set<string>>();
	for (const raw of entries) {
		if (!raw) continue;
		const body = raw.slice("ext:".length);
		const slash = body.indexOf("/");
		// Extension name matches case-insensitively (matches the loader-side canonical
		// name). Tool names are case-preserved — they're matched against pi-mono's
		// registered identifiers, which are case-sensitive.
		const name = (slash === -1 ? body : body.slice(0, slash)).trim().toLowerCase();
		if (!name) continue;
		extNames.add(name);
		if (slash === -1) continue;
		const tool = body.slice(slash + 1).trim();
		if (!tool) continue;
		let set = narrowing.get(name);
		if (!set) {
			set = new Set();
			narrowing.set(name, set);
		}
		set.add(tool);
	}
	return { extNames, narrowing };
}

/**
 * Keep a subagent's tool scope correct as extensions register tools over time.
 *
 * Extensions may call `registerTool` long after load — pi-mcp from `session_start`,
 * context-mode from `before_agent_start` — so scope has to be re-derived rather than
 * snapshotted. `registerTool` writes into the very `extension.tools` maps this reads,
 * so `inScope()` sees late arrivals on the next call.
 *
 * Two enforcement points, because neither covers the whole picture:
 *
 *   - `turn_end` re-narrows the ACTIVE set. pi emits `turn_end` immediately before
 *     `prepareNextTurn` re-snapshots `agent.state.tools`, and session listeners run
 *     synchronously, so the narrow lands in time for turns 2..N.
 *   - `beforeToolCall` blocks out-of-scope calls. Turn 1 cannot be narrowed at all:
 *     `before_agent_start` fires INSIDE `prompt()` and may widen the tool set, but
 *     `createContextSnapshot()` freezes that turn's tools immediately after — there
 *     is no hook in between. A call-time check is the only correct guard there.
 *
 * Both are installed on the session and deliberately NOT unsubscribed: they must
 * outlive the `runAgent` call so resumed/steered turns stay scoped. pi's `dispose()`
 * clears `_eventListeners`, so they die with the session rather than leaking.
 *
 * Only meaningful when extensions are loaded — under `noExtensions`/`isolated` the
 * static `allowedToolNames` allowlist already gates the registry itself.
 */
export function installExtensionToolScope(
	session: AgentSession,
	ctx: {
		loader: DefaultResourceLoader;
		toolNames: string[];
		disallowedSet: Set<string> | undefined;
		extNames: Set<string>;
		narrowing: Map<string, Set<string>>;
	},
): void {
	const { loader, toolNames, disallowedSet, extNames, narrowing } = ctx;

	// The names allowed right now. Mirrors the `ext:` opt-in flip: when any `ext:`
	// selector is present, extension tools become an explicit allowlist — a loaded
	// extension not named by a selector contributes nothing (its handlers still ran),
	// and `ext:foo/bar` narrows `foo` to just `bar`.
	const inScope = (): Set<string> => {
		const keep = new Set(toolNames.filter((t) => !disallowedSet?.has(t)));
		const optInActive = extNames.size > 0;
		for (const extension of loader.getExtensions().extensions) {
			const canons = extensionCanonicalNames(extension.path);
			if (optInActive && !canons.some((c) => extNames.has(c))) continue;
			// First alias that carries a narrowing set — a user won't narrow one
			// extension under two different names, so first-match is correct.
			const narrowed = canons.map((c) => narrowing.get(c)).find(Boolean);
			for (const name of extension.tools.keys()) {
				if (narrowed && !narrowed.has(name)) continue;
				if (disallowedSet?.has(name)) continue;
				keep.add(name);
			}
		}
		for (const name of EXCLUDED_TOOL_NAMES) keep.delete(name);
		return keep;
	};

	const renarrow = () => {
		const allowed = inScope();
		const next = session.getAllTools().map((t) => t.name).filter((n) => allowed.has(n));
		const current = session.getActiveToolNames();
		// setActiveToolsByName unconditionally rebuilds the system prompt, so skip
		// the no-op that steady-state turns would otherwise pay for every turn.
		if (next.length !== current.length || next.some((n, i) => n !== current[i])) {
			session.setActiveToolsByName(next);
		}
	};

	// Activate what registered during session_start (eager MCP servers); pi would
	// otherwise leave only its four default built-ins active at turn 1.
	renarrow();

	session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "turn_end") renarrow();
	});

	const priorBeforeToolCall = session.agent.beforeToolCall;
	session.agent.beforeToolCall = async (context, signal) => {
		if (!inScope().has(context.toolCall.name)) {
			return {
				block: true,
				reason: `Tool "${context.toolCall.name}" is not available to this subagent.`,
			};
		}
		return priorBeforeToolCall?.(context, signal);
	};
}
