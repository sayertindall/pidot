/**
 * Model Filter Extension — /pmodel command
 *
 * Filters models by provider, shows rich metadata (context window, cost,
 * reasoning), supports search within large providers, persists recent models,
 * and offers info subcommands.
 *
 * Commands:
 *   /pmodel              → pick provider, then pick model
 *   /pmodel <provider>   → skip provider picker
 *   /pmodel list         → show all providers with auth status and model counts
 *   /pmodel current      → show current model details
 *   /pmodel recent       → pick from recently used models
 *   /pmodel search <q>   → search models by name/id across all providers
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface RecentModelEntry {
	provider: string;
	modelId: string;
	displayName: string;
	timestamp: number;
}

interface ModelFilterState {
	recentModels: RecentModelEntry[];
}

interface ProviderDisplayItem {
	label: string;
	provider: string;
}

interface ModelFamilyGroup {
	family: string;
	models: Model<Api>[];
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const STATE_FILE = "model-filter-state.json";
const MAX_RECENT = 10;
const SEARCH_THRESHOLD = 20;

// ──────────────────────────────────────────
// State persistence
// ──────────────────────────────────────────

function getStatePath(): string {
	return join(getAgentDir(), STATE_FILE);
}

function ensureDir(path: string): void {
	const idx = path.lastIndexOf("/");
	if (idx < 0) return;
	const dir = path.slice(0, idx);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function loadState(): ModelFilterState {
	try {
		const path = getStatePath();
		if (!existsSync(path)) return { recentModels: [] };
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as ModelFilterState;
	} catch {
		return { recentModels: [] };
	}
}

function saveState(state: ModelFilterState): void {
	try {
		const path = getStatePath();
		ensureDir(path);
		writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
	} catch {
		// best-effort
	}
}

function recordModelUse(model: Model<Api>): void {
	const state = loadState();
	const filtered = state.recentModels.filter(
		(e) => !(e.provider === model.provider && e.modelId === model.id),
	);
	filtered.unshift({
		provider: model.provider,
		modelId: model.id,
		displayName: model.name ?? model.id,
		timestamp: Date.now(),
	});
	state.recentModels = filtered.slice(0, MAX_RECENT);
	saveState(state);
}

// ──────────────────────────────────────────
// Model metadata formatting
// ──────────────────────────────────────────

function isZeroCost(cost: Model<Api>["cost"]): boolean {
	if (!cost) return true;
	return cost.input === 0 && cost.output === 0 && cost.cacheRead === 0 && cost.cacheWrite === 0;
}

function formatCost(cost: Model<Api>["cost"] | undefined): string {
	if (!cost || isZeroCost(cost)) return "free";
	const fmt = (n: number) => (n < 0.01 ? `${(n * 1000).toFixed(1)}m` : `$${n}`);
	return `${fmt(cost.input)}/${fmt(cost.output)}`;
}

function formatContextWindow(model: Model<Api>): string {
	const cw = model.contextWindow;
	if (!cw) return "";
	if (cw >= 1_000_000) return `${(cw / 1_000_000).toFixed(1)}M ctx`;
	if (cw >= 1_000) return `${(cw / 1_000).toFixed(0)}K ctx`;
	return `${cw} ctx`;
}

function formatMaxTokens(model: Model<Api>): string {
	const mt = model.maxTokens;
	if (!mt) return "";
	if (mt >= 1_000) return `${(mt / 1_000).toFixed(0)}K max`;
	return `${mt} max`;
}

function modelTags(model: Model<Api>): string[] {
	const tags: string[] = [];
	if (model.reasoning) tags.push("reasoning");
	if (model.input?.includes("image")) tags.push("vision");
	return tags;
}

function formatModelDisplay(model: Model<Api>, showProvider?: boolean): string {
	const label = model.name ?? model.id;
	const meta: string[] = [];
	const cw = formatContextWindow(model);
	if (cw) meta.push(cw);
	const cost = formatCost(model.cost);
	if (cost) meta.push(cost);
	const tags = modelTags(model);
	if (tags.length > 0) meta.push(tags.join(", "));

	let result = label;
	if (meta.length > 0) {
		result += ` │ ${meta.join(" │ ")}`;
	}
	if (showProvider) {
		result += ` [${model.provider}]`;
	}
	return result;
}

function detectModelFamily(modelId: string): string {
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		return modelId.slice(0, slashIdx);
	}
	const match = modelId.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
	if (match) return match[1]!.toLowerCase();
	return modelId;
}

function groupModelsByFamily(models: Model<Api>[]): ModelFamilyGroup[] {
	const groups = new Map<string, Model<Api>[]>();
	for (const model of models) {
		const family = detectModelFamily(model.id);
		const list = groups.get(family) ?? [];
		list.push(model);
		groups.set(family, list);
	}
	return [...groups.entries()]
		.map(([family, familyModels]) => ({
			family,
			models: familyModels.sort((a, b) =>
				(a.name ?? a.id).localeCompare(b.name ?? b.id),
			),
		}))
		.sort((a, b) => a.family.localeCompare(b.family));
}

// ──────────────────────────────────────────
// Provider display helpers
// ──────────────────────────────────────────

function getAuthIndicator(
	ctx: ExtensionCommandContext,
	_provider: string,
	models: Model<Api>[],
): string {
	const sample = models.slice(0, 3);
	const hasAuth = sample.some((m) => ctx.modelRegistry.hasConfiguredAuth(m));
	return hasAuth ? "✓" : "⚠ no key";
}

function buildProviderDisplayItems(
	byProvider: Map<string, Model<Api>[]>,
	ctx: ExtensionCommandContext,
): ProviderDisplayItem[] {
	const items: ProviderDisplayItem[] = [];
	for (const [provider, models] of byProvider) {
		const count = models.length;
		const auth = getAuthIndicator(ctx, provider, models);
		const label = `${provider} (${count} model${count === 1 ? "" : "s"})  ${auth}`;
		items.push({ label, provider });
	}
	return items;
}

// ──────────────────────────────────────────
// Model resolution helpers
// ──────────────────────────────────────────

function getModelsByProvider(ctx: ExtensionCommandContext): Map<string, Model<Api>[]> {
	const models = ctx.modelRegistry.getAvailable();
	const byProvider = new Map<string, Model<Api>[]>();
	for (const model of models) {
		const list = byProvider.get(model.provider) ?? [];
		list.push(model);
		byProvider.set(model.provider, list);
	}
	const sorted = new Map(
		[...byProvider.entries()].sort((a, b) => a[0]!.localeCompare(b[0]!)),
	);
	for (const [, list] of sorted) {
		list.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
	}
	return sorted;
}

function resolveProvider(
	byProvider: Map<string, Model<Api>[]>,
	raw: string,
): string | undefined {
	const lower = raw.toLowerCase();
	for (const [name] of byProvider) {
		if (name.toLowerCase() === lower) return name;
	}
	for (const [name] of byProvider) {
		if (name.toLowerCase().startsWith(lower)) return name;
	}
	return undefined;
}

// ──────────────────────────────────────────
// Picker UI steps
// ──────────────────────────────────────────

async function pickProviderStep(
	ctx: ExtensionCommandContext,
	byProvider: Map<string, Model<Api>[]>,
): Promise<string | undefined> {
	const items = buildProviderDisplayItems(byProvider, ctx);
	const labels = items.map((i) => i.label);
	const selected = await ctx.ui.select("Select Provider", labels);
	if (!selected) return undefined;
	const item = items.find((i) => i.label === selected);
	return item?.provider;
}

async function selectModelFromList(
	ctx: ExtensionCommandContext,
	models: Model<Api>[],
	title: string,
): Promise<Model<Api> | undefined> {
	const modelItems = models.map((m) => formatModelDisplay(m));
	const selectedStr = await ctx.ui.select(title, modelItems);
	if (!selectedStr) return undefined;
	const selectedLabel = selectedStr.split(" │")[0]!.trim();
	const model = models.find((m) => (m.name ?? m.id) === selectedLabel);
	return model;
}

async function pickModelByFamily(
	ctx: ExtensionCommandContext,
	models: Model<Api>[],
	provider: string,
): Promise<Model<Api> | undefined> {
	const groups = groupModelsByFamily(models);
	const familyItems = groups.map(
		(g) => `${g.family} (${g.models.length} model${g.models.length === 1 ? "" : "s"})`,
	);
	const selectedFamily = await ctx.ui.select(
		`Select Model Family (${provider})`,
		familyItems,
	);
	if (!selectedFamily) return undefined;
	const familyName = selectedFamily.split(" (")[0]!;
	const group = groups.find((g) => g.family === familyName);
	if (!group) {
		ctx.ui.notify("Family not found.", "error");
		return undefined;
	}
	return selectModelFromList(ctx, group.models, `Select Model (${provider} - ${group.family})`);
}

async function pickModelStep(
	ctx: ExtensionCommandContext,
	models: Model<Api>[],
	provider: string,
): Promise<Model<Api> | undefined> {
	if (models.length === 0) {
		ctx.ui.notify(`No models found for provider: ${provider}`, "error");
		return undefined;
	}

	let filteredModels = models;
	if (models.length > SEARCH_THRESHOLD) {
		const choice = await ctx.ui.select(
			`${provider} has ${models.length} models`,
			[
				"🔍 Search by name",
				`📋 Browse all ${models.length} models`,
				"📂 Browse by family",
			],
		);
		if (!choice) return undefined;

		if (choice.startsWith("🔍")) {
			const query = await ctx.ui.input(
				`Search ${provider} models`,
				"Type a model name or ID...",
			);
			if (!query) return undefined;
			const lower = query.toLowerCase();
			filteredModels = models.filter(
				(m) =>
					m.id.toLowerCase().includes(lower) ||
					(m.name ?? "").toLowerCase().includes(lower),
			);
			if (filteredModels.length === 0) {
				ctx.ui.notify(`No models match "${query}"`, "warning");
				return undefined;
			}
		} else if (choice.startsWith("📂")) {
			return pickModelByFamily(ctx, models, provider);
		}
	}

	return selectModelFromList(ctx, filteredModels, `Select Model (${provider})`);
}

// ──────────────────────────────────────────
// Apply model with error recovery
// ──────────────────────────────────────────

async function applyModel(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	model: Model<Api>,
): Promise<void> {
	const success = await pi.setModel(model);
	if (success) {
		recordModelUse(model);
		ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "info");
	} else {
		ctx.ui.notify(
			`Failed to switch to ${model.provider}/${model.id} — API key may be missing or invalid`,
			"warning",
		);
	}
}

// ──────────────────────────────────────────
// Subcommand: /pmodel current
// ──────────────────────────────────────────

function showCurrentModel(ctx: ExtensionCommandContext): void {
	const model = ctx.model;
	if (!model) {
		ctx.ui.notify("No model selected.", "warning");
		return;
	}

	const lines: string[] = [
		`Model:        ${model.id}`,
		`Provider:     ${model.provider}`,
		`Display name: ${model.name ?? "(none)"}`,
		`Context:      ${formatContextWindow(model) || "unknown"}`,
		`Max tokens:   ${formatMaxTokens(model) || "unknown"}`,
		`Cost:         ${formatCost(model.cost) || "unknown"}`,
		`Reasoning:    ${model.reasoning ? "yes" : "no"}`,
		`Input types:  ${(model.input ?? ["text"]).join(", ")}`,
	];

	ctx.ui.notify(lines.join("\n"), "info");
}

// ──────────────────────────────────────────
// Subcommand: /pmodel list
// ──────────────────────────────────────────

function listProviders(
	ctx: ExtensionCommandContext,
	byProvider: Map<string, Model<Api>[]>,
): void {
	const lines: string[] = ["Configured providers:"];
	for (const [provider, models] of byProvider) {
		const auth = getAuthIndicator(ctx, provider, models);
		lines.push(`  ${provider} (${models.length} models) ${auth}`);
	}
	ctx.ui.notify(lines.join("\n"), "info");
}

// ──────────────────────────────────────────
// Subcommand: /pmodel recent
// ──────────────────────────────────────────

async function showRecentModels(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const state = loadState();
	const recent = state.recentModels;
	if (recent.length === 0) {
		ctx.ui.notify("No recent models.", "info");
		return;
	}

	const items = recent.map((e) => `${e.provider}/${e.modelId}`);
	const selected = await ctx.ui.select("Recent Models (most recent first)", items);
	if (!selected) return;

	const slashIdx = selected.indexOf("/");
	if (slashIdx < 0) return;
	const provider = selected.slice(0, slashIdx);
	const modelId = selected.slice(slashIdx + 1);
	const model = ctx.modelRegistry.find(provider, modelId);
	if (!model) {
		ctx.ui.notify(`Model ${selected} is no longer available.`, "warning");
		return;
	}
	await applyModel(pi, ctx, model);
}

// ──────────────────────────────────────────
// Subcommand: /pmodel search <query>
// ──────────────────────────────────────────

async function searchModels(
	query: string,
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const byProvider = getModelsByProvider(ctx);
	const lower = query.toLowerCase();
	const matches: Model<Api>[] = [];

	for (const [, models] of byProvider) {
		for (const model of models) {
			if (
				model.id.toLowerCase().includes(lower) ||
				(model.name ?? "").toLowerCase().includes(lower)
			) {
				matches.push(model);
			}
		}
	}

	if (matches.length === 0) {
		ctx.ui.notify(`No models match "${query}"`, "warning");
		return;
	}

	matches.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

	if (matches.length === 1) {
		await applyModel(pi, ctx, matches[0]!);
		return;
	}

	const items = matches.map((m) => formatModelDisplay(m, true));
	const selected = await ctx.ui.select(
		`Models matching "${query}" (${matches.length})`,
		items,
	);
	if (!selected) return;

	const selectedLabel = selected.split(" │")[0]!.trim();
	const model = matches.find((m) => (m.name ?? m.id) === selectedLabel);
	if (!model) {
		ctx.ui.notify("Model not found.", "error");
		return;
	}
	await applyModel(pi, ctx, model);
}

// ──────────────────────────────────────────
// Main command handler
// ──────────────────────────────────────────

async function runModelPicker(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	providerArg?: string,
): Promise<void> {
	const byProvider = getModelsByProvider(ctx);

	if (byProvider.size === 0) {
		ctx.ui.notify("No models available. Check API keys and models.json.", "warning");
		return;
	}

	let provider: string | undefined;

	if (providerArg) {
		provider = resolveProvider(byProvider, providerArg);
		if (!provider) {
			ctx.ui.notify(
				`Provider "${providerArg}" not found. Use /pmodel list to see available providers.`,
				"error",
			);
			return;
		}
	} else {
		provider = await pickProviderStep(ctx, byProvider);
		if (!provider) return;
	}

	const models = byProvider.get(provider);
	if (!models || models.length === 0) {
		ctx.ui.notify(`No models found for provider: ${provider}`, "error");
		return;
	}

	const model = await pickModelStep(ctx, models, provider);
	if (!model) return;

	await applyModel(pi, ctx, model);
}

// ──────────────────────────────────────────
// Extension entry point
// ──────────────────────────────────────────

export default function modelFilterExtension(pi: ExtensionAPI): void {
	pi.registerCommand("pmodel", {
		description: [
			"Pick a model by provider, with rich metadata display.",
			"  /pmodel              Interactive provider + model picker",
			"  /pmodel <provider>   Skip provider picker (e.g. /pmodel anthropic)",
			"  /pmodel list         List all providers and model counts",
			"  /pmodel current      Show current model details",
			"  /pmodel recent       Pick from recently used models",
			"  /pmodel search <q>   Search all models by name or ID",
		].join("\n"),
		getArgumentCompletions: () => {
			// Provider names need the model registry, which isn't available
			// at completion time (only argumentPrefix is passed).
			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = args?.trim();
			if (!trimmed) {
				await runModelPicker(pi, ctx);
				return;
			}

			const parts = trimmed.split(/\s+/);
			const sub = parts[0]!.toLowerCase();

			switch (sub) {
				case "list": {
					const byProvider = getModelsByProvider(ctx);
					listProviders(ctx, byProvider);
					return;
				}
				case "current":
				case "info": {
					showCurrentModel(ctx);
					return;
				}
				case "recent": {
					await showRecentModels(pi, ctx);
					return;
				}
				case "search": {
					const query = parts.slice(1).join(" ");
					if (!query) {
						ctx.ui.notify("Usage: /pmodel search <query>", "warning");
						return;
					}
					await searchModels(query, pi, ctx);
					return;
				}
				default: {
					await runModelPicker(pi, ctx, trimmed);
				}
			}
		},
	});
}
