/**
 * _shared/terminal-status.ts
 *
 * The 4-state completion contract every harness in SUB-SPEC-v3 maps
 * onto. The 4-state union is the cross-package contract shared with
 * the `pi` harness (SUB-SPEC-v3 §2.4). The fifth state
 * `interrupted` is reserved for future harness types that
 * distinguish external signal from internal failure; the current
 * mapping never returns it.
 *
 * The mapping table (per PI-PROCESS-IMPL-SPEC.md §D4) is
 * load-bearing for the pi-subagents integration; it is the contract
 * the `interactive-shell` harness callback returns its `HarnessResult`
 * against.
 *
 * TESTING: every row of the mapping table is enumerated as a fixture
 * test in `terminal-status.test.ts`. This is the canonical
 * acceptance test for the completion contract.
 */

export type TerminalStatus = "completed" | "failed" | "stopped" | "interrupted";

export type TerminalStatusInputs = {
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly cancelled: boolean;
	readonly timedOut: boolean;
	readonly sentinelSeen: boolean;
};

export function toTerminalStatus(inputs: TerminalStatusInputs): TerminalStatus {
	// TODO: implement the full mapping table from PI-PROCESS-IMPL-SPEC.md
	// §D4. For the scaffold, return `failed` as a safe default; the
	// real impl covers all 8 rows of the table.
	void inputs;
	return "failed";
}
