import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mutateStateEager, makeDebouncedPersister } from "../state";

describe("state", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-config-state-test-"));
		vi.useRealTimers();
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
		vi.useRealTimers();
	});

	describe("mutateStateEager", () => {
		it("writes the new state atomically", async () => {
			const path = join(tmp, "state.json");
			const result = await mutateStateEager<{ count: number }>(
				path,
				(current) => ({ count: current.count + 1 }),
				{ count: 0 },
			);
			expect(result).toEqual({ count: 1 });
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 1 });
		});

		it("reads existing state before transforming", async () => {
			const path = join(tmp, "state.json");
			await mutateStateEager<{ v: number }>(path, (c) => ({ v: c.v + 1 }), { v: 0 });
			await mutateStateEager<{ v: number }>(path, (c) => ({ v: c.v + 1 }), { v: 0 });
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ v: 2 });
		});

		it("supports no-op transforms that return undefined", async () => {
			const path = join(tmp, "state.json");
			await mutateStateEager<{ v: number }>(path, () => ({ v: 5 }), { v: 0 });
			const result = await mutateStateEager<{ v: number }>(
				path,
				() => undefined,
				{ v: 0 },
			);
			expect(result).toEqual({ v: 5 });
		});
	});

	describe("makeDebouncedPersister", () => {
		it("coalesces multiple schedule() calls into one write", async () => {
			const path = join(tmp, "state.json");
			const persister = makeDebouncedPersister<{ v: number }>(path, { v: 0 }, 50);

			persister.schedule({ v: 1 });
			persister.schedule({ v: 2 });
			persister.schedule({ v: 3 });
			expect(existsSync(path)).toBe(false); // not written yet

			await vi.waitFor(() => {
				if (!existsSync(path)) throw new Error("not yet");
			}, { timeout: 500 });
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ v: 3 });
		});

		it("flush() writes immediately", async () => {
			const path = join(tmp, "state.json");
			const persister = makeDebouncedPersister<{ v: number }>(path, { v: 0 }, 10_000);
			persister.schedule({ v: 7 });
			expect(existsSync(path)).toBe(false);
			await persister.flush();
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ v: 7 });
		});

		it("cancel() drops the pending value", async () => {
			const path = join(tmp, "state.json");
			const persister = makeDebouncedPersister<{ v: number }>(path, { v: 0 }, 10_000);
			persister.schedule({ v: 9 });
			persister.cancel();
			await persister.flush();
			expect(existsSync(path)).toBe(false);
			expect(persister.pending()).toBe(false);
		});
	});
});
