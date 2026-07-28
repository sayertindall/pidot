/**
 * pi-toolkit-tilldone — types
 *
 * Pure type definitions. No runtime, no side effects.
 */

/** Valid task statuses. */
export type TaskStatus = "idle" | "inprogress" | "done";

/** A single task in the tilldone list. */
export interface Task {
	id: number;
	text: string;
	status: TaskStatus;
	/** Optional gate: shell command to run before marking "done". Exit 0 = pass. */
	gate?: string;
}

/** Persisted state shape. */
export interface TillDoneState {
	enabled: boolean;
	tasks: Task[];
	nextId: number;
}

/** Structured details returned from every tilldone tool call. */
export interface TillDoneDetails {
	action: string;
	tasks: Task[];
	nextId: number;
	error?: string;
}
