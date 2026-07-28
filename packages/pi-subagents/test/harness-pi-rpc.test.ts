import { describe, expect, it } from "vitest";
import { runViaPiRpc } from "../extensions/subagents/harness-pi-rpc.ts";

describe("runViaPiRpc", () => {
	it("throws an error indicating the harness is not yet implemented", async () => {
		await expect(runViaPiRpc({} as never)).rejects.toThrow(
			'harness: "pi-rpc" is specified',
		);
	});

	it("throws an error that mentions the correct alternatives", async () => {
		await expect(runViaPiRpc({} as never)).rejects.toThrow(
			'Use harness: "pi" (the default, in-process) or harness: "interactive-shell" instead.',
		);
	});

	it("throws with SUB-SPEC-v4 §4A reference in the message", async () => {
		await expect(runViaPiRpc({} as never)).rejects.toThrow(
			"SUB-SPEC-v4.md §4A",
		);
	});

	it("always throws regardless of the config argument", async () => {
		// The function signature takes a PiRpcLaunchConfig but ignores it entirely.
		await expect(
			runViaPiRpc({ taskName: "test", message: "hi", cwd: "/tmp", parentSessionId: "abc", inheritedProvider: "test", inheritedModelId: "model" } as never),
		).rejects.toThrow();

		await expect(
			runViaPiRpc({ harness: "pi-rpc" } as never),
		).rejects.toThrow();
	});

	it("never returns a result", async () => {
		// This is purely a "not implemented" guard — it must always reject.
		let threw = false;
		try {
			await runViaPiRpc({} as never);
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});
