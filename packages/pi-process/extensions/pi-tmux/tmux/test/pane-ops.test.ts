import { describe, expect, it } from "vitest";
import { capturePane, findPane, listAllPanes, stripAnsi } from "../pane-ops";
import type { Exec } from "../types";

function fakeExec(responses: Map<string, { code: number; stdout: string; stderr: string }>): Exec {
	return async (cmd, args) => {
		const key = `${cmd} ${args.join(" ")}`;
		const response = responses.get(key);
		if (!response) throw new Error(`Unexpected call: ${key}`);
		return response;
	};
}

describe("stripAnsi", () => {
	it("removes CSI sequences", () => {
		expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
	});

	it("removes OSC sequences terminated by BEL", () => {
		expect(stripAnsi("\x1b]0;title\x07after")).toBe("after");
	});

	it("removes OSC sequences terminated by ST", () => {
		expect(stripAnsi("\x1b]0;title\x1b\\after")).toBe("after");
	});

	it("removes tmux passthrough", () => {
		expect(stripAnsi("\x1bPtmux;%something\x1b\\after")).toBe("after");
	});

	it("removes bare escapes", () => {
		// The bare-escape regex strips the ESC + next byte. "a\x1bbc"
		// has ESC + "b" stripped, leaving "a" + "c" = "ac".
		expect(stripAnsi("a\x1bbc")).toBe("ac");
	});

	it("removes carriage returns", () => {
		expect(stripAnsi("line1\rline2")).toBe("line1line2");
	});

	it("returns plain text unchanged", () => {
		expect(stripAnsi("hello world")).toBe("hello world");
	});

	it("handles empty input", () => {
		expect(stripAnsi("")).toBe("");
	});
});

describe("findPane", () => {
	it("returns pane info when name matches", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{
						code: 0,
						stdout: "%1\tdev\tnode\t1234\t0\n%2\t\tvim\t5678\t0\n",
						stderr: "",
					},
				],
			]),
		);
		const pane = await findPane("dev", exec, "@1");
		expect(pane).toEqual({ name: "dev", paneId: "%1", alive: true, command: "node", pid: "1234" });
	});

	it("returns null when name not found", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{ code: 0, stdout: "%1\tsomething\tnode\t1234\t0\n", stderr: "" },
				],
			]),
		);
		expect(await findPane("missing", exec, "@1")).toBeNull();
	});

	it("returns null on nonzero exit", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{ code: 1, stdout: "", stderr: "no server" },
				],
			]),
		);
		expect(await findPane("any", exec, "@1")).toBeNull();
	});
});

describe("listAllPanes", () => {
	it("returns all panes when myPaneId is null", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{
						code: 0,
						stdout: "%1\tdev\tnode\t1234\t0\n%2\t\tvim\t5678\t1\n",
						stderr: "",
					},
				],
			]),
		);
		const panes = await listAllPanes(exec, "@1", null);
		expect(panes).toEqual([
			{ name: "dev", paneId: "%1", alive: true, command: "node", pid: "1234" },
			{ name: "", paneId: "%2", alive: false, command: "vim", pid: "5678" },
		]);
	});

	it("filters out myPaneId", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{ code: 0, stdout: "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n", stderr: "" },
				],
			]),
		);
		const panes = await listAllPanes(exec, "@1", "%1");
		expect(panes).toEqual([{ name: "dev", paneId: "%2", alive: true, command: "node", pid: "1234" }]);
	});

	it("skips blank lines", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{ code: 0, stdout: "%1\tdev\tnode\t1234\t0\n\n%2\t\tvim\t5678\t0\n", stderr: "" },
				],
			]),
		);
		const panes = await listAllPanes(exec, "@1", null);
		expect(panes).toHaveLength(2);
	});

	it("returns empty array on nonzero exit", async () => {
		const exec = fakeExec(
			new Map([
				[
					"tmux list-panes -t @1 -F #{pane_id}\t#{@pi_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_dead}",
					{ code: 1, stdout: "", stderr: "no server" },
				],
			]),
		);
		expect(await listAllPanes(exec, "@1", null)).toEqual([]);
	});
});

describe("capturePane", () => {
	it("captures and strips ANSI", async () => {
		const exec = fakeExec(
			new Map([["tmux capture-pane -t %1 -p -S -20", { code: 0, stdout: "\x1b[32mhello\x1b[0m world", stderr: "" }]]),
		);
		const output = await capturePane("%1", 20, exec);
		expect(output).toBe("hello world");
	});

	it("trims trailing blank lines", async () => {
		const exec = fakeExec(new Map([["tmux capture-pane -t %1 -p -S -20", { code: 0, stdout: "line1\n\n\n", stderr: "" }]]));
		const output = await capturePane("%1", 20, exec);
		expect(output).toBe("line1\n");
	});

	it("throws on capture-pane failure", async () => {
		const exec = fakeExec(new Map([["tmux capture-pane -t %1 -p -S -20", { code: 1, stdout: "", stderr: "no pane" }]]));
		await expect(capturePane("%1", 20, exec)).rejects.toThrow("capture-pane failed: no pane");
	});
});
