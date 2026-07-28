import { Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshSpawn } from "../remote-ops";
import sshToolsExtension from "../index";

/**
 * Fake child process. Uses EventEmitter for stdout/stderr/close
 * (not Readable) because Readable.push() has surprising async
 * "data" event timing in vitest.
 */
class FakeChild {
	stdin: Writable;
	stdout: EventEmitter;
	stderr: EventEmitter;
	private closeEmitter = new EventEmitter();
	private errorEmitter = new EventEmitter();
	written: Buffer[] = [];
	spawnArgs: Array<{ cmd: string; args: readonly string[] }> = [];

	constructor() {
		this.stdin = new Writable({
			write: (chunk, _enc, cb) => {
				this.written.push(Buffer.from(chunk));
				cb();
			},
		});
		this.stdout = new EventEmitter();
		this.stderr = new EventEmitter();
	}

	on(event: string, handler: (...args: unknown[]) => void): this {
		if (event === "data") {
			this.stdout.on("data", handler);
			this.stderr.on("data", handler);
		} else if (event === "close") {
			this.closeEmitter.on("close", handler);
		} else if (event === "error") {
			this.errorEmitter.on("error", handler);
		}
		return this;
	}

	emitStdout(data: Buffer | string): void {
		this.stdout.emit("data", typeof data === "string" ? Buffer.from(data) : data);
	}

	emitStderr(data: Buffer | string): void {
		this.stderr.emit("data", typeof data === "string" ? Buffer.from(data) : data);
	}

	emitClose(exitCode: number | null): void {
		this.closeEmitter.emit("close", exitCode);
	}

	emitError(error: Error): void {
		this.errorEmitter.emit("error", error);
	}

	kill(): void {
		// No-op.
	}
}

/**
 * Spy on spawn calls; returns a SshSpawn that records args and
 * returns a fresh FakeChild per call.
 */
function spyingSpawn(): { spawnImpl: SshSpawn; children: FakeChild[] } {
	const children: FakeChild[] = [];
	const spawnImpl: SshSpawn = ((cmd: string, args: readonly string[]) => {
		const child = new FakeChild();
		child.spawnArgs.push({ cmd, args: [...args] });
		children.push(child);
		return child as unknown as ReturnType<SshSpawn>;
	}) as SshSpawn;
	return { spawnImpl, children };
}

interface CapturedTool {
	name: string;
	parameters: unknown;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<unknown>;
}

interface CapturedCommand {
	name: string;
	description: string;
	handler: (args: string, ctx: CommandCtx) => Promise<void>;
	getArgumentCompletions?: (prefix: string) => unknown;
}

interface CommandCtx {
	ui: {
		notify: ReturnType<typeof vi.fn>;
		select: ReturnType<typeof vi.fn>;
	};
}

function fakePi(opts: {
	configPath?: string;
	spawnImpl: SshSpawn;
	activeTools?: string[];
}) {
	const tools: CapturedTool[] = [];
	const commands: CapturedCommand[] = [];
	const sessionStartHandlers: Array<(event: unknown, ctx: unknown) => Promise<void>> = [];
	const beforeAgentStartHandlers: Array<(event: { systemPrompt: string }) => Promise<unknown>> = [];
	const activeTools = new Set<string>(opts.activeTools ?? []);

	const fakeCtx: CommandCtx = {
		ui: {
			notify: vi.fn(),
			select: vi.fn(),
		},
	};
	const fullFakeCtx = {
		...fakeCtx,
		ui: {
			...fakeCtx.ui,
			setStatus: vi.fn(),
			theme: { fg: (_c: string, s: string) => s },
		},
	};

	const pi = {
		registerTool: (t: CapturedTool) => {
			tools.push(t);
		},
		registerCommand: (
			name: string,
			def: {
				description: string;
				handler: CapturedCommand["handler"];
				getArgumentCompletions?: CapturedCommand["getArgumentCompletions"];
			},
		) => {
			commands.push({
				name,
				description: def.description,
				handler: def.handler,
				getArgumentCompletions: def.getArgumentCompletions,
			});
		},
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			if (event === "session_start") sessionStartHandlers.push(handler as never);
			if (event === "before_agent_start") beforeAgentStartHandlers.push(handler as never);
		},
		getActiveTools: () => Array.from(activeTools),
		setActiveTools: (names: string[]) => {
			activeTools.clear();
			for (const n of names) activeTools.add(n);
		},
	};

	sshToolsExtension(pi as never, {
		spawnImpl: opts.spawnImpl,
		configPath: opts.configPath,
		home: "/home/test",
	});

	return {
		pi,
		tools,
		commands,
		sessionStartHandlers,
		beforeAgentStartHandlers,
		fakeCtx,
		fullFakeCtx,
		activeTools,
	};
}

async function writeConfig(tmp: string, body: string): Promise<string> {
	const { writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const path = join(tmp, "config");
	writeFileSync(path, body);
	return path;
}

async function makeTmp(): Promise<string> {
	const { mkdtempSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	return mkdtempSync(join(tmpdir(), "pi-ssh-"));
}

describe("pi-ssh /ssh command", () => {
	let tmp: string;
	let configPath: string;
	let children: FakeChild[];
	let spawnImpl: SshSpawn;

	beforeEach(async () => {
		tmp = await makeTmp();
		configPath = await writeConfig(
			tmp,
			`Host dev
  HostName dev.example.com

Host prod
  HostName prod.example.com
`,
		);
		const spy = spyingSpawn();
		spawnImpl = spy.spawnImpl;
		children = spy.children;
	});

	afterEach(async () => {
		const { rmSync } = await import("node:fs");
		rmSync(tmp, { recursive: true, force: true });
	});

	it("registers ssh_read, ssh_write, ssh_edit, ssh_bash tools and the /ssh command", () => {
		const { tools, commands } = fakePi({ configPath, spawnImpl });
		const toolNames = tools.map((t) => t.name).sort();
		expect(toolNames).toEqual(["ssh_bash", "ssh_edit", "ssh_read", "ssh_write"]);
		expect(commands.map((c) => c.name)).toEqual(["ssh"]);
	});

	it("/ssh status reports off when no target is active", async () => {
		const { commands, fakeCtx } = fakePi({ configPath, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		await ssh.handler("status", fakeCtx);
		expect(fakeCtx.ui.notify).toHaveBeenCalledWith("SSH mode is off", "info");
	});

	it("/ssh <profile> activates and runs pwd to discover the remote cwd", async () => {
		const { commands, fullFakeCtx, activeTools } = fakePi({ configPath, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		const promise = ssh.handler("dev", fullFakeCtx);
		const last = children[children.length - 1];
		if (!last) throw new Error("no child spawned");
		last.emitStdout("/home/user/dev");
		last.emitClose(0);
		await promise;

		// The spawn was for ssh dev pwd.
		const lastSpawn = last.spawnArgs[0];
		expect(lastSpawn?.cmd).toBe("ssh");
		expect(lastSpawn?.args).toEqual(["dev", "pwd"]);

		// The four ssh_* tools are now active.
		expect([...activeTools].sort()).toEqual(["ssh_bash", "ssh_edit", "ssh_read", "ssh_write"]);

		// Status line set.
		expect(fullFakeCtx.ui.setStatus).toHaveBeenCalledWith(
			"ssh-tools",
			expect.stringContaining("SSH dev:/home/user/dev"),
		);
	});

	it("/ssh host:/path splits into remote + cwd", async () => {
		const { commands, fullFakeCtx } = fakePi({ configPath, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		// pwd is skipped because profile.cwd is set; no spawn.
		await ssh.handler("dev:/var/www", fullFakeCtx);
		expect(children).toHaveLength(0);

		expect(fullFakeCtx.ui.notify).toHaveBeenCalledWith("SSH mode on: dev:/var/www (/var/www)", "info");
	});

	it("/ssh off deactivates and removes the ssh_* tools from active set", async () => {
		const { commands, fullFakeCtx, activeTools } = fakePi({
			configPath,
			spawnImpl,
			activeTools: ["ssh_read", "ssh_write", "ssh_edit", "ssh_bash", "bash"],
		});

		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		// First activate.
		const activate = ssh.handler("dev", fullFakeCtx);
		const child0 = children[children.length - 1];
		if (!child0) throw new Error("no child");
		child0.emitStdout("/home/user/dev");
		child0.emitClose(0);
		await activate;
		expect(activeTools.has("ssh_read")).toBe(true);

		// Then deactivate.
		await ssh.handler("off", fullFakeCtx);
		expect(activeTools.has("ssh_read")).toBe(false);
		expect(activeTools.has("ssh_write")).toBe(false);
		expect(activeTools.has("ssh_edit")).toBe(false);
		expect(activeTools.has("ssh_bash")).toBe(false);
		// Local bash tool remains.
		expect(activeTools.has("bash")).toBe(true);
	});

	it("/ssh off when already off is a no-op notification", async () => {
		const { commands, fakeCtx } = fakePi({ configPath, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		await ssh.handler("off", fakeCtx);
		expect(fakeCtx.ui.notify).toHaveBeenCalledWith("SSH mode is already off", "info");
	});

	it("/ssh with no input and no profiles warns the user", async () => {
		const emptyTmp = await makeTmp();
		const emptyConfig = await writeConfig(emptyTmp, "");
		const { commands, fakeCtx } = fakePi({ configPath: emptyConfig, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		await ssh.handler("", fakeCtx);
		expect(fakeCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No SSH hosts found"), "warning");

		const { rmSync } = await import("node:fs");
		rmSync(emptyTmp, { recursive: true, force: true });
	});

	it("getArgumentCompletions returns profile names plus 'off' and 'status'", () => {
		const { commands } = fakePi({ configPath, spawnImpl });
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh?.getArgumentCompletions) throw new Error("ssh command not registered");

		const all = ssh.getArgumentCompletions("");
		const names = (all as Array<{ value: string }>).map((c) => c.value).sort();
		expect(names).toEqual(["dev", "off", "prod", "status"]);
	});
});

describe("pi-ssh tools throw when SSH mode is off", () => {
	let tmp: string;
	let configPath: string;
	let spawnImpl: SshSpawn;

	beforeEach(async () => {
		tmp = await makeTmp();
		configPath = await writeConfig(tmp, "Host dev\n");
		const spy = spyingSpawn();
		spawnImpl = spy.spawnImpl;
	});

	afterEach(async () => {
		const { rmSync } = await import("node:fs");
		rmSync(tmp, { recursive: true, force: true });
	});

	it.each(["ssh_read", "ssh_write", "ssh_edit", "ssh_bash"])("%s requires an active target", async (toolName) => {
		const { tools } = fakePi({ configPath, spawnImpl });
		const tool = tools.find((t) => t.name === toolName);
		if (!tool) throw new Error(`${toolName} not registered`);

		await expect(tool.execute("id", {}, undefined, undefined, undefined)).rejects.toThrow(/SSH mode is off/);
	});
});

describe("pi-ssh before_agent_start injects SSH context", () => {
	let tmp: string;
	let configPath: string;
	let spawnImpl: SshSpawn;
	let children: FakeChild[];

	beforeEach(async () => {
		tmp = await makeTmp();
		configPath = await writeConfig(tmp, "Host dev\n");
		const spy = spyingSpawn();
		spawnImpl = spy.spawnImpl;
		children = spy.children;
	});

	afterEach(async () => {
		const { rmSync } = await import("node:fs");
		rmSync(tmp, { recursive: true, force: true });
	});

	it("appends the SSH context when a target is active", async () => {
		const { commands, fullFakeCtx, beforeAgentStartHandlers } = fakePi({ configPath, spawnImpl });

		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");

		const activatePromise = ssh.handler("dev", fullFakeCtx);
		const child0 = children[children.length - 1];
		if (!child0) throw new Error("no child");
		child0.emitStdout("/var/www");
		child0.emitClose(0);
		await activatePromise;

		const handler = beforeAgentStartHandlers[0];
		if (!handler) throw new Error("before_agent_start not registered");

		const result = (await handler({ systemPrompt: "base" })) as { systemPrompt: string };
		expect(result.systemPrompt).toContain("base");
		expect(result.systemPrompt).toContain("SSH mode is active");
		expect(result.systemPrompt).toContain("dev");
		expect(result.systemPrompt).toContain("/var/www");
	});

	it("returns the unmodified system prompt when no target is active", async () => {
		const { beforeAgentStartHandlers } = fakePi({ configPath, spawnImpl });

		const handler = beforeAgentStartHandlers[0];
		if (!handler) throw new Error("before_agent_start not registered");

		const result = await handler({ systemPrompt: "base" });
		expect(result).toBeUndefined();
	});
});

describe("pi-ssh session_start resets active target", () => {
	let tmp: string;
	let configPath: string;
	let spawnImpl: SshSpawn;
	let children: FakeChild[];

	beforeEach(async () => {
		tmp = await makeTmp();
		configPath = await writeConfig(tmp, "Host dev\n");
		const spy = spyingSpawn();
		spawnImpl = spy.spawnImpl;
		children = spy.children;
	});

	afterEach(async () => {
		const { rmSync } = await import("node:fs");
		rmSync(tmp, { recursive: true, force: true });
	});

	it("deactivates on session_start", async () => {
		const { commands, sessionStartHandlers, activeTools, fullFakeCtx } = fakePi({
			configPath,
			spawnImpl,
			activeTools: ["bash"],
		});

		// Activate.
		const ssh = commands.find((c) => c.name === "ssh");
		if (!ssh) throw new Error("ssh command not registered");
		const activate = ssh.handler("dev", fullFakeCtx);
		const child0 = children[children.length - 1];
		if (!child0) throw new Error("no child");
		child0.emitStdout("/var/www");
		child0.emitClose(0);
		await activate;

		// Trigger session_start with a ctx that has the right shape.
		const handler = sessionStartHandlers[0];
		if (!handler) throw new Error("session_start not registered");
		await handler({}, { ui: { ...fullFakeCtx.ui } });

		// After session_start, the ssh_* tools are no longer in
		// the active set.
		expect(activeTools.has("ssh_read")).toBe(false);
	});
});
