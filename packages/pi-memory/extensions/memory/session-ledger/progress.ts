import { estimateEntryTokens } from "../tokens.js";
import {
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	type Entry,
	type V3MemoryCustomType,
} from "./types.js";

const SOURCE_ENTRY_TYPES = new Set(["message", "custom_message", "branch_summary"]);

export function isSourceEntry(entry: Entry): boolean {
	return SOURCE_ENTRY_TYPES.has(entry.type);
}

export function entryIndexById(entries: Entry[]): Map<string, number> {
	const idToIndex = new Map<string, number>();
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry) idToIndex.set(entry.id, i);
	}
	return idToIndex;
}

export function entryIndexForId(entries: Entry[], entryId: string | undefined): number {
	if (!entryId) return -1;
	const idx = entryIndexById(entries).get(entryId);
	return idx ?? -1;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyArray(value: unknown): value is unknown[] {
	return Array.isArray(value) && value.length > 0;
}

function isValidCoverageEntry(entry: Entry, customType: V3MemoryCustomType): entry is Entry & { data: { coversUpToId: string } } {
	if (entry.type !== "custom" || entry.customType !== customType) return false;
	if (!isObject(entry.data) || typeof entry.data.coversUpToId !== "string") return false;

	if (customType === OM_OBSERVATIONS_RECORDED) return isNonEmptyArray(entry.data.observations);
	if (customType === OM_REFLECTIONS_RECORDED) return isNonEmptyArray(entry.data.reflections);
	return isNonEmptyArray(entry.data.observationIds);
}

export function latestCoverageIndex(entries: Entry[], customType: V3MemoryCustomType): number {
	const idToIndex = entryIndexById(entries);
	let latest = -1;

	for (const entry of entries) {
		if (!isValidCoverageEntry(entry, customType)) continue;
		const coveredIndex = idToIndex.get(entry.data.coversUpToId);
		if (coveredIndex === undefined) continue;
		if (coveredIndex > latest) latest = coveredIndex;
	}

	return latest;
}

export function latestCoverageMarkerId(entries: Entry[], customType: V3MemoryCustomType): string | undefined {
	const idToIndex = entryIndexById(entries);
	let latestIndex = -1;
	let latestMarkerId: string | undefined;

	for (const entry of entries) {
		if (!isValidCoverageEntry(entry, customType)) continue;
		const coveredIndex = idToIndex.get(entry.data.coversUpToId);
		if (coveredIndex === undefined) continue;
		if (coveredIndex > latestIndex) {
			latestIndex = coveredIndex;
			latestMarkerId = entry.data.coversUpToId;
		}
	}

	return latestMarkerId;
}

export function earlierCoverageMarkerId(entries: Entry[], firstId: string | undefined, secondId: string | undefined): string | undefined {
	if (!firstId) return secondId;
	if (!secondId) return firstId;

	const idToIndex = entryIndexById(entries);
	const firstIndex = idToIndex.get(firstId);
	const secondIndex = idToIndex.get(secondId);
	if (firstIndex === undefined) return secondIndex === undefined ? undefined : secondId;
	if (secondIndex === undefined) return firstId;
	return firstIndex <= secondIndex ? firstId : secondId;
}

export function rawTokensAfterIndex(entries: Entry[], index: number): number {
	let total = 0;
	for (let i = Math.max(0, index + 1); i < entries.length; i++) {
		const entry = entries[i];
		if (entry && isSourceEntry(entry)) total += estimateEntryTokens(entry);
	}
	return total;
}

export function rawTokensSinceCoverage(entries: Entry[], customType: V3MemoryCustomType): number {
	return rawTokensAfterIndex(entries, latestCoverageIndex(entries, customType));
}

export function rawTokensSinceObservationCoverage(entries: Entry[]): number {
	return rawTokensSinceCoverage(entries, OM_OBSERVATIONS_RECORDED);
}

export function rawTokensSinceReflectionCoverage(entries: Entry[]): number {
	return rawTokensSinceCoverage(entries, OM_REFLECTIONS_RECORDED);
}

export function rawTokensSinceDropCoverage(entries: Entry[]): number {
	return rawTokensSinceCoverage(entries, OM_OBSERVATIONS_DROPPED);
}

export function findLastCompactionIndex(entries: Entry[]): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "compaction") return i;
	}
	return -1;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usageTokensFromMessage(message: unknown): number | undefined {
	if (!message || typeof message !== "object") return undefined;
	const usage = (message as { usage?: unknown }).usage;
	if (!usage || typeof usage !== "object") return undefined;

	const asObject = usage as {
		totalTokens?: unknown;
		total_tokens?: unknown;
		tokens?: unknown;
		input?: unknown;
		output?: unknown;
	};
	const totalTokens = asNumber(asObject.totalTokens);
	if (totalTokens !== undefined) return totalTokens;
	const totalTokensSnake = asNumber(asObject.total_tokens);
	if (totalTokensSnake !== undefined) return totalTokensSnake;
	const tokenField = asNumber(asObject.tokens);
	if (tokenField !== undefined) return tokenField;

	const inputTokens = asNumber(asObject.input) ?? 0;
	const outputTokens = asNumber(asObject.output) ?? 0;
	if (inputTokens + outputTokens > 0) return inputTokens + outputTokens;
	return undefined;
}

function currentAssistantUsageTokens(entries: Entry[]): number | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!entry || entry.type !== "message") continue;
		const message = entry.message;
		if (!message || typeof message !== "object") continue;
		if ((message as { role?: unknown }).role !== "assistant") continue;
		const usageTokens = usageTokensFromMessage(message);
		if (usageTokens !== undefined) return usageTokens;
	}
	return undefined;
}

/**
 * Prefer actual assistant-context usage if available; fallback to estimated raw
 * source tokens when usage is not present.
 */
export function compactationTokenPressure(entries: Entry[]): number | undefined {
	return currentAssistantUsageTokens(entries) ?? rawTokensSinceLastCompaction(entries);
}

export function rawTokensSinceLastCompaction(entries: Entry[]): number {
	const compactionIndex = findLastCompactionIndex(entries);
	if (compactionIndex === -1) return rawTokensAfterIndex(entries, -1);

	const compactionEntry = entries[compactionIndex];
	if (!compactionEntry) return rawTokensAfterIndex(entries, -1);

	const firstKeptEntryId = compactionEntry.firstKeptEntryId;
	const firstKeptIndex = entryIndexForId(entries, firstKeptEntryId);

	if (firstKeptIndex === -1) return rawTokensAfterIndex(entries, compactionIndex);
	return rawTokensAfterIndex(entries, firstKeptIndex - 1);
}
