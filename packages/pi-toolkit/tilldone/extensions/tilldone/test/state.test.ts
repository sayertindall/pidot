/**
 * state.test.ts
 *
 * Tests for readStateOrEmpty, writeStateAtomic, mutateState.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultState } from '../schemas';
import { mutateState, readStateOrEmpty, statePath, writeStateAtomic } from '../state';
import type { TillDoneState } from '../types';

let FAKE_HOME = "";

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return {
		...actual,
		homedir: () => FAKE_HOME,
	};
});

let sessionId: string;

beforeEach(() => {
	FAKE_HOME = mkdtempSync(join(tmpdir(), "tilldone-state-test-"));
	sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
	rmSync(FAKE_HOME, { recursive: true, force: true });
});

describe("readStateOrEmpty", () => {
	it("returns default state when file does not exist", () => {
		const state = readStateOrEmpty(sessionId);
		expect(state).toEqual(defaultState());
	});

	it("reads valid state from disk", () => {
		const expected: TillDoneState = {
			enabled: true,
			tasks: [{ id: 1, text: "hello", status: "inprogress" }],
			nextId: 2,
		};
		const path = statePath(sessionId);
		writeStateAtomic(path, expected);

		const state = readStateOrEmpty(sessionId);
		expect(state).toEqual(expected);
	});

	it("returns default when file contains bad JSON", () => {
		const path = statePath(sessionId);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "not json {{{", "utf8");

		const state = readStateOrEmpty(sessionId);
		expect(state).toEqual(defaultState());
	});

	it("returns default when JSON does not match schema (missing enabled)", () => {
		const path = statePath(sessionId);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ tasks: [] }), "utf8");

		const state = readStateOrEmpty(sessionId);
		expect(state).toEqual(defaultState());
	});

	it("returns default when task has invalid status", () => {
		const path = statePath(sessionId);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				enabled: true,
				tasks: [{ id: 1, text: "x", status: "invalid" }],
				nextId: 2,
			}),
			"utf8",
		);

		const state = readStateOrEmpty(sessionId);
		expect(state).toEqual(defaultState());
	});
});

describe("writeStateAtomic", () => {
	it("writes state and makes it readable", () => {
		const state: TillDoneState = {
			enabled: true,
			tasks: [
				{ id: 1, text: "a", status: "idle" },
				{ id: 2, text: "b", status: "done", gate: "npm test" },
			],
			nextId: 3,
		};
		const path = statePath(sessionId);
		writeStateAtomic(path, state);

		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual(state);
	});
});

describe("mutateState", () => {
	it("creates state if missing and applies transform", async () => {
		const result = await mutateState(sessionId, (s) => ({
			...s,
			enabled: true,
			tasks: [{ id: 1, text: "x", status: "idle" }],
			nextId: 2,
		}));

		expect(result.enabled).toBe(true);
		expect(result.tasks).toHaveLength(1);

		// Read back from disk.
		const onDisk = readStateOrEmpty(sessionId);
		expect(onDisk).toEqual(result);
	});

	it("returns current state when transform returns undefined", async () => {
		// First, write a state.
		await mutateState(sessionId, (s) => ({
			...s,
			enabled: true,
			tasks: [{ id: 1, text: "x", status: "idle" }],
		}));

		// Now transform that returns undefined — should not change state.
		const result = await mutateState(sessionId, () => undefined);
		expect(result.enabled).toBe(true);
		expect(result.tasks).toHaveLength(1);
	});

	it("serialises concurrent mutations", async () => {
		// Fire several mutations in parallel; the final nextId should be consistent.
		const N = 10;
		const promises = Array.from({ length: N }, (_, i) =>
			mutateState(sessionId, (s) => ({
				...s,
				tasks: [...s.tasks, { id: s.nextId, text: `task-${i}`, status: "idle" }],
				nextId: s.nextId + 1,
			})),
		);

		const results = await Promise.all(promises);
		const final = results[results.length - 1]!;
		expect(final.tasks).toHaveLength(N);
		// nextId should be N+1 (starting from 1).
		expect(final.nextId).toBe(N + 1);
	});
});
