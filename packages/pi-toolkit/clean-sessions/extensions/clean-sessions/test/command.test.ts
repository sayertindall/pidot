/**
 * command.test.ts
 *
 * End-to-end tests for the command handlers using mock modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanupResult, SessionCandidate } from '../types';

// ============================================================================
// Mocks
// ============================================================================

const mockFindCandidates = vi.fn();
const mockMoveToTrash = vi.fn();
const mockListTrash = vi.fn();
const mockEmptyTrash = vi.fn();

vi.mock("../candidate", () => ({
	findCandidates: mockFindCandidates,
	DEFAULT_DAYS: 30,
	MIN_LINES: 12,
	SESSIONS_DIR: "/mock/.pi/agent/sessions",
}));

vi.mock("../trash", () => ({
	moveToTrash: (...args: unknown[]) => mockMoveToTrash(...args),
	listTrash: (...args: unknown[]) => mockListTrash(...args),
	emptyTrash: (...args: unknown[]) => mockEmptyTrash(...args),
}));

// Mock fs.access to always succeed, since our mock SESSIONS_DIR doesn't exist.
vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		promises: {
			...actual.promises,
			access: vi.fn().mockResolvedValue(undefined),
			readdir: actual.promises.readdir,
			mkdir: actual.promises.mkdir,
			stat: actual.promises.stat,
			writeFile: actual.promises.writeFile,
			unlink: actual.promises.unlink,
		},
	};
});

// ============================================================================
// Helpers
// ============================================================================

let notifyCalls: Array<[string, string]> = [];
let inputResolve: ((value: string) => void) | null = null;

function resetNotify() {
	notifyCalls = [];
}

function notify(msg: string, level: string) {
	notifyCalls.push([msg, level]);
}

function input(_prompt: string, _default: string): Promise<string> {
	return new Promise((resolve) => {
		inputResolve = resolve;
	});
}

function resolveInput(value: string) {
	if (inputResolve) {
		inputResolve(value);
		inputResolve = null;
	}
}

function makeFakeCtx(overrides: { hasUI?: boolean } = {}) {
	const ctx = {
		hasUI: overrides.hasUI ?? true,
		ui: {
			notify,
			input,
			setWorkingMessage: vi.fn(),
			setWorkingIndicator: vi.fn(),
		},
	};
	return ctx as unknown as import("@earendil-works/pi-coding-agent").ExtensionCommandContext;
}

function makeCandidate(overrides: Partial<SessionCandidate> = {}): SessionCandidate {
	return {
		path: "/mock/sessions/2025-01-15T00-00-00-000Z_test.jsonl",
		mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
		sizeBytes: 100,
		lineCount: 5,
		name: null,
		ageDays: 60,
		...overrides,
	};
}

// ============================================================================
// Dynamic import
// ============================================================================

async function importHandlers() {
	const mod = await import("../command");
	return {
		handleCleanSessions: mod.handleCleanSessions,
		handleEmptySessionTrash: mod.handleEmptySessionTrash,
	};
}

// ============================================================================
// Tests: /clean-sessions
// ============================================================================

describe("handleCleanSessions", () => {
	beforeEach(() => {
		resetNotify();
		inputResolve = null;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("notifies error when not interactive", async () => {
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx({ hasUI: false });

		await handleCleanSessions("", ctx);

		expect(notifyCalls).toContainEqual([
			"/clean-sessions requires an interactive session",
			"error",
		]);
	});

	it("notifies warning for invalid days argument", async () => {
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		await handleCleanSessions("abc", ctx);

		expect(notifyCalls).toContainEqual([
			expect.stringContaining('Invalid argument: "abc"'),
			"warning",
		]);
	});

	it("notifies warning for negative days argument", async () => {
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		await handleCleanSessions("-5", ctx);

		expect(notifyCalls).toContainEqual([
			expect.stringContaining("Invalid argument"),
			"warning",
		]);
	});

	it("notifies info when no candidates found", async () => {
		mockFindCandidates.mockResolvedValue([]);
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		await handleCleanSessions("", ctx);

		expect(notifyCalls).toContainEqual([
			expect.stringContaining("No cleanup candidates found"),
			"info",
		]);
	});

	it("shows candidates and cancels when user types wrong count", async () => {
		const candidates = [makeCandidate(), makeCandidate()];
		mockFindCandidates.mockResolvedValue(candidates);
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		const handlerPromise = handleCleanSessions("", ctx);

		// Let the handler reach the input prompt.
		await new Promise((r) => setTimeout(r, 10));

		// User types wrong number.
		resolveInput("999");

		await handlerPromise;

		// Should show the summary.
		expect(notifyCalls.some(([msg]) => msg.includes("Found 2 sessions"))).toBe(
			true,
		);
		// Should show canceled message.
		expect(
			notifyCalls.some(([msg]) => msg.includes("Cleanup canceled")),
		).toBe(true);
		// Should NOT call moveToTrash.
		expect(mockMoveToTrash).not.toHaveBeenCalled();
	});

	it("shows candidates, confirms, and moves to trash", async () => {
		const candidates = [makeCandidate(), makeCandidate()];
		mockFindCandidates.mockResolvedValue(candidates);
		mockMoveToTrash.mockResolvedValue({
			movedCount: 2,
			failedCount: 0,
			trashSubdir: "2026-01-15T00-00-00-000Z",
		} satisfies CleanupResult);

		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		const handlerPromise = handleCleanSessions("", ctx);

		// Let the handler reach the input prompt.
		await new Promise((r) => setTimeout(r, 10));

		// User types the correct count.
		resolveInput("2");

		await handlerPromise;

		expect(mockMoveToTrash).toHaveBeenCalledWith(candidates);
		expect(notifyCalls.some(([msg]) => msg.includes("Moved 2 sessions"))).toBe(
			true,
		);
	});

	it("uses custom days argument", async () => {
		mockFindCandidates.mockResolvedValue([]);
		const { handleCleanSessions } = await importHandlers();
		const ctx = makeFakeCtx();

		await handleCleanSessions("60", ctx);

		expect(mockFindCandidates).toHaveBeenCalledWith({ olderThanDays: 60 });
	});
});

// ============================================================================
// Tests: /empty-session-trash
// ============================================================================

describe("handleEmptySessionTrash", () => {
	beforeEach(() => {
		resetNotify();
		inputResolve = null;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("notifies error when not interactive", async () => {
		const { handleEmptySessionTrash } = await importHandlers();
		const ctx = makeFakeCtx({ hasUI: false });

		await handleEmptySessionTrash("", ctx);

		expect(notifyCalls).toContainEqual([
			"/empty-session-trash requires an interactive session",
			"error",
		]);
	});

	it("notifies info when trash is empty", async () => {
		mockListTrash.mockResolvedValue({ subdirs: [], totalSize: 0 });
		const { handleEmptySessionTrash } = await importHandlers();
		const ctx = makeFakeCtx();

		await handleEmptySessionTrash("", ctx);

		expect(notifyCalls).toContainEqual([
			"Session trash is already empty.",
			"info",
		]);
	});

	it("shows contents and cancels when user declines", async () => {
		mockListTrash.mockResolvedValue({
			subdirs: ["2026-01-15T00-00-00-000Z"],
			totalSize: 1000,
		});

		const { handleEmptySessionTrash } = await importHandlers();
		const ctx = makeFakeCtx();

		const handlerPromise = handleEmptySessionTrash("", ctx);

		await new Promise((r) => setTimeout(r, 10));

		// User types something other than the count (which is 1, the subdir count).
		resolveInput("no");

		await handlerPromise;

		expect(mockEmptyTrash).not.toHaveBeenCalled();
		expect(
			notifyCalls.some(([msg]) => msg.includes("Canceled")),
		).toBe(true);
	});

	it("shows contents, confirms, and empties trash", async () => {
		mockListTrash.mockResolvedValue({
			subdirs: ["2026-01-15T00-00-00-000Z"],
			totalSize: 1000,
		});
		mockEmptyTrash.mockResolvedValue({
			removedCount: 3,
			bytesFreed: 5000,
		});

		const { handleEmptySessionTrash } = await importHandlers();
		const ctx = makeFakeCtx();

		const handlerPromise = handleEmptySessionTrash("", ctx);

		await new Promise((r) => setTimeout(r, 10));

		// User confirms by typing "1" (the subdir count).
		resolveInput("1");
		await handlerPromise;

		expect(mockEmptyTrash).toHaveBeenCalled();
		expect(notifyCalls.some(([msg]) => msg.includes("Permanently deleted"))).toBe(
			true,
		);
	});
});
