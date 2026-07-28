/**
 * State I/O — eager and debounced.
 *
 * Eager writes happen on lifecycle transitions (preset activated, safety
 * override set). High-frequency activity (rapid cycling, transient UI
 * state) coalesces through `makeDebouncedPersister` so a runaway burst
 * collapses to one disk write per debounce window.
 *
 * Every write goes through `withFileMutationQueue` so concurrent writers
 * for the same file serialize, and through `writeStateAtomic` so a crash
 * never leaves a half-written file on disk.
 */

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { readStateOrEmpty, writeStateAtomic } from "./io";

/**
 * Apply a synchronous transform to a state file inside the mutation
 * queue. Returns the new state. If the transform returns `undefined`,
 * the file is left untouched and the current state is returned.
 */
export async function mutateStateEager<T>(
	path: string,
	transform: (current: T) => T | undefined,
	_empty: T,
): Promise<T> {
	return withFileMutationQueue(path, async () => {
		const current = readStateOrEmpty(path, _empty);
		const next = transform(current);
		if (next === undefined) return current;
		writeStateAtomic(path, next);
		return next;
	});
}

/**
 * Build a debounced persister for a state file. `schedule(state)` records
 * the latest value and resets the timer. After `debounceMs` of quiet,
 * the latest value is written atomically through the mutation queue.
 * `flush()` forces a write of the latest pending value (or no-op if none).
 */
export interface DebouncedPersister<T> {
	schedule(next: T): void;
	flush(): Promise<void>;
	cancel(): void;
	pending(): boolean;
}

export function makeDebouncedPersister<T>(
	path: string,
	_empty: T,
	debounceMs = 1000,
): DebouncedPersister<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: T | undefined;
	let hasPending = false;

	const flush = async (): Promise<void> => {
		timer = undefined;
		if (!hasPending) return;
		const value = pending as T;
		hasPending = false;
		pending = undefined;
		await withFileMutationQueue(path, async () => {
			writeStateAtomic(path, value);
		});
	};

	return {
		schedule(next) {
			pending = next;
			hasPending = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				void flush();
			}, debounceMs);
		},
		flush: flush,
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
			pending = undefined;
			hasPending = false;
		},
		pending() {
			return hasPending;
		},
	};
}
