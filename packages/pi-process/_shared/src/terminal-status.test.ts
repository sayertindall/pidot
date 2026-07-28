import { describe, expect, it } from "vitest";
import { toTerminalStatus, type TerminalStatusInputs } from "./terminal-status";

describe("toTerminalStatus (stub)", () => {
	const baseInputs: TerminalStatusInputs = {
		exitCode: 0,
		signal: null,
		cancelled: false,
		timedOut: false,
		sentinelSeen: true,
	};

	it("returns a status (stub returns failed)", () => {
		expect(toTerminalStatus(baseInputs)).toBe("failed");
	});
});
