import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piTmux from "../index";

/**
 * Test the tool's run/read/send/stop/list actions end-to-end by
 * providing a fake `pi` whose `exec` returns canned tmux output,
 * and capturing registered tools and event handlers so the test
 * can drive them.
 */

interface CapturedTool {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<{
		content: Array<{ type: string; text: string }>;
		details?: Record<string, unknown>;
	}>;
}

function fakePi(exec: (cmd: string, args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>) {
	const tools: CapturedTool[] = [];
	const sessionStartHandlers: Array<(event: unknown, ctx: ExtensionContext) => Promise<void>> = [];
	const fakeCtx = {
		ui: {
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			notify: vi.fn(),
			confirm: vi.fn(),
		},
	} as unknown as ExtensionContext;

	// Wrap the test's exec with a fallback for the session_start
	// `display-message` discovery call: return a valid pane/window
	// pair so the extension can resolve `requireWindowTarget()`.
	const execWithDefault: typeof exec = async (cmd, args) => {
		if (cmd === "tmux" && args[0] === "display-message") {
			return { code: 0, stdout: "%1\t@1\t$1", stderr: "" };
		}
		return exec(cmd, args);
	};

	const pi = {
		exec: execWithDefault as unknown as ExtensionAPI["exec"],
		registerTool: (t: CapturedTool) => {
			tools.push(t);
		},
		registerCommand: vi.fn(),
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
			if (event === "session_start") sessionStartHandlers.push(handler);
		},
		getActiveTools: vi.fn().mockReturnValue([]),
		setActiveTools: vi.fn(),
	} as unknown as ExtensionAPI;

	return { pi, tools, sessionStartHandlers, ctx: fakeCtx };
}

const initialEnv = { ...process.env };

beforeEach(() => {
	process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
	process.env.TMUX_PANE = "%1";
	process.env.HERDR_ENV = "";
});

afterEach(() => {
	process.env = { ...initialEnv };
});

describe("pi-tmux activation gate", () => {
	it("registers the tool when TMUX is set and HERDR_ENV is not", () => {
		const { pi, tools } = fakePi(async () => ({ code: 0, stdout: "", stderr: "" }));
		piTmux(pi);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.name).toBe("tmux");
	});

	it("does not register when TMUX is unset", () => {
		delete process.env.TMUX;
		const { pi, tools } = fakePi(async () => ({ code: 0, stdout: "", stderr: "" }));
		piTmux(pi);
		expect(tools).toHaveLength(0);
	});

	it("does not register when HERDR_ENV is set", () => {
		process.env.HERDR_ENV = "1";
		const { pi, tools } = fakePi(async () => ({ code: 0, stdout: "", stderr: "" }));
		piTmux(pi);
		expect(tools).toHaveLength(0);
	});
});

describe("pi-tmux run action", () => {
	it("starts a new pane when no existing pane", async () => {
		const listPanesOutput = "%1\t\tpi\t99\t0\n";
		const splitOutput = "%2\n";
		const captureOutput = "starting...\n";
		const calls: string[] = [];
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			calls.push(`${cmd} ${args.join(" ")}`);
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: listPanesOutput, stderr: "" };
			}
			if (cmd === "tmux" && args[0] === "split-window") {
				return { code: 0, stdout: splitOutput, stderr: "" };
			}
			if (cmd === "tmux" && args[0] === "capture-pane") {
				return { code: 0, stdout: captureOutput, stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		const result = await tmux.execute("id", { action: "run", pane: "dev", command: "npm run dev" }, undefined, undefined, undefined);

		expect(calls.some((c) => c.includes("split-window"))).toBe(true);
		expect(calls.some((c) => c.includes("set-option"))).toBe(true);
		expect(calls.some((c) => c.includes("send-keys -l"))).toBe(true);
		expect(calls.some((c) => c.includes("send-keys -t %2 Enter"))).toBe(true);
		expect(result.details).toEqual({
			action: "run",
			pane: "dev",
			paneId: "%2",
			command: "npm run dev",
			position: "right",
		});
		expect(result.content[0]?.text).toContain("Started 'npm run dev' in pane 'dev' (%2)");
	});

	it("throws when pane already alive and restart is false", async () => {
		const listPanesOutput = "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n";
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: listPanesOutput, stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await expect(
			tmux.execute("id", { action: "run", pane: "dev", command: "x" }, undefined, undefined, undefined),
		).rejects.toThrow(/already exists/);
	});

	it("kills and replaces an existing pane when restart is true", async () => {
		const listPanesOutput = "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n";
		const calls: string[] = [];
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			calls.push(`${cmd} ${args.join(" ")}`);
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: listPanesOutput, stderr: "" };
			}
			if (cmd === "tmux" && args[0] === "split-window") {
				return { code: 0, stdout: "%3\n", stderr: "" };
			}
			if (cmd === "tmux" && args[0] === "capture-pane") {
				return { code: 0, stdout: "ok\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await tmux.execute("id", { action: "run", pane: "dev", command: "x", restart: true }, undefined, undefined, undefined);
		expect(calls.some((c) => c === "tmux kill-pane -t %2")).toBe(true);
	});
});

describe("pi-tmux read action", () => {
	it("captures output from a named pane", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n", stderr: "" };
			}
			if (cmd === "tmux" && args[0] === "capture-pane") {
				return { code: 0, stdout: "line1\nline2\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		const result = await tmux.execute("id", { action: "read", pane: "dev" }, undefined, undefined, undefined);
		expect(result.details).toEqual({ action: "read", pane: "dev", alive: true, command: "node" });
		// capturePane normalizes to one trailing newline; truncateTail
		// preserves it on the no-truncation path.
		expect(result.content[0]?.text).toBe("line1\nline2\n");
	});

	it("throws when pane not found", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\t\tpi\t99\t0\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await expect(
			tmux.execute("id", { action: "read", pane: "missing" }, undefined, undefined, undefined),
		).rejects.toThrow(/not found/);
	});
});

describe("pi-tmux send action", () => {
	it("sends keys to a named pane", async () => {
		const calls: string[] = [];
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			calls.push(`${cmd} ${args.join(" ")}`);
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await tmux.execute("id", { action: "send", pane: "dev", keys: "C-c" }, undefined, undefined, undefined);
		expect(calls).toContain("tmux send-keys -t %2 C-c");
	});

	it("requires keys or text", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async () => ({ code: 0, stdout: "", stderr: "" }));
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await expect(tmux.execute("id", { action: "send", pane: "dev" }, undefined, undefined, undefined)).rejects.toThrow(
			/keys.*text/,
		);
	});
});

describe("pi-tmux stop action", () => {
	it("kills a named pane", async () => {
		const calls: string[] = [];
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			calls.push(`${cmd} ${args.join(" ")}`);
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		const result = await tmux.execute("id", { action: "stop", pane: "dev" }, undefined, undefined, undefined);
		expect(calls).toContain("tmux kill-pane -t %2");
		expect(result.details).toEqual({ action: "stop", pane: "dev" });
	});

	it("refuses to kill the pane pi is running in", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\tself\tpi\t99\t0\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		await expect(tmux.execute("id", { action: "stop", pane: "self" }, undefined, undefined, undefined)).rejects.toThrow(
			/Refusing to kill the pane pi is running in/,
		);
	});
});

describe("pi-tmux list action", () => {
	it("lists managed panes", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return {
					code: 0,
					stdout: "%1\t\tpi\t99\t0\n%2\tdev\tnode\t1234\t0\n%3\t\tvim\t5678\t1\n",
					stderr: "",
				};
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		const result = await tmux.execute("id", { action: "list" }, undefined, undefined, undefined);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("dev: running (node)");
		// Format is "[vim]: dead (vim) [%3] (unmanaged)".
		expect(text).toContain("[vim]: dead (vim)");
		expect(text).toContain("(unmanaged)");
		expect(text).not.toContain("pi:");
	});

	it("reports empty when only pi's pane exists", async () => {
		const { pi, tools, sessionStartHandlers } = fakePi(async (cmd, args) => {
			if (cmd === "tmux" && args[0] === "list-panes") {
				return { code: 0, stdout: "%1\t\tpi\t99\t0\n", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		});
		piTmux(pi);
		await sessionStartHandlers[0]?.({}, {} as ExtensionContext);

		const tmux = tools[0];
		if (!tmux) throw new Error("tool not registered");

		const result = await tmux.execute("id", { action: "list" }, undefined, undefined, undefined);
		expect(result.content[0]?.text).toBe("No panes (besides pi).");
	});
});
