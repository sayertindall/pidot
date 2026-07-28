import { Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshSpawn } from "../remote-ops";
import { createRemoteBashOps, inferImageMimeType, sshExec, sshOk } from "../remote-ops";

/**
 * Fake child process. Uses EventEmitter for stdout/stderr because
 * vitest + Readable.push() has surprising "data" event timing
 * (the event fires async, not sync on push, in this environment).
 * The remote-ops.ts code only attaches "data" and "close" listeners
 * to stdout/stderr, so a plain EventEmitter is sufficient.
 */
class FakeChild {
	stdin: Writable;
	stdout: EventEmitter;
	stderr: EventEmitter;
	private closeEmitter = new EventEmitter();
	private errorEmitter = new EventEmitter();
	written: Buffer[] = [];

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

function fakeSpawn(child: FakeChild): SshSpawn {
	return ((_cmd: string, _args: readonly string[]) => {
		return child as unknown as ReturnType<SshSpawn>;
	}) as SshSpawn;
}

describe("sshExec", () => {
	let child: FakeChild;
	let spawnImpl: SshSpawn;

	beforeEach(() => {
		child = new FakeChild();
		spawnImpl = fakeSpawn(child);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves with stdout, stderr, and exit code on clean exit", async () => {
		const promise = sshExec("dev", "ls", {}, spawnImpl);
		child.emitStdout("file1\nfile2\n");
		child.emitClose(0);

		const result = await promise;
		expect(result.stdout.toString()).toBe("file1\nfile2\n");
		expect(result.stderr.length).toBe(0);
		expect(result.exitCode).toBe(0);
	});

	it("writes stdin and ends it", async () => {
		const promise = sshExec("dev", "cat", { stdin: "hello" }, spawnImpl);
		child.emitClose(0);

		await promise;
		expect(child.written.map((b) => b.toString())).toEqual(["hello"]);
	});

	it("captures stderr", async () => {
		const promise = sshExec("dev", "false", {}, spawnImpl);
		child.emitStderr("permission denied");
		child.emitClose(1);

		const result = await promise;
		expect(result.stdout.length).toBe(0);
		expect(result.stderr.toString()).toBe("permission denied");
		expect(result.exitCode).toBe(1);
	});

	it("rejects with 'aborted' when signal aborts", async () => {
		const controller = new AbortController();
		const promise = sshExec("dev", "long", { signal: controller.signal }, spawnImpl);
		controller.abort();
		child.emitClose(null);

		await expect(promise).rejects.toThrow("aborted");
	});

	it("rejects with 'timeout:N' when timeout fires", async () => {
		vi.useFakeTimers();
		const promise = sshExec("dev", "long", { timeoutSeconds: 1 }, spawnImpl);
		vi.advanceTimersByTime(1000);
		child.emitClose(null);
		await expect(promise).rejects.toThrow("timeout:1");
	});

	it("invokes onStdoutData for streaming output", async () => {
		const onStdoutData = vi.fn();
		const promise = sshExec("dev", "ls", { onStdoutData }, spawnImpl);
		child.emitStdout("streaming");
		child.emitClose(0);

		await promise;
		expect(onStdoutData).toHaveBeenCalledWith(Buffer.from("streaming"));
	});

	it("rejects with the underlying error on spawn failure", async () => {
		const promise = sshExec("dev", "ls", {}, spawnImpl);
		child.emitError(new Error("ENOENT"));

		await expect(promise).rejects.toThrow("ENOENT");
	});
});

describe("sshOk", () => {
	let child: FakeChild;
	let spawnImpl: SshSpawn;

	beforeEach(() => {
		child = new FakeChild();
		spawnImpl = fakeSpawn(child);
	});

	it("returns stdout on success", async () => {
		const promise = sshOk("dev", "ls", {}, spawnImpl);
		child.emitStdout("ok\n");
		child.emitClose(0);

		const result = await promise;
		expect(result.toString()).toBe("ok\n");
	});

	it("throws on nonzero exit, surfacing stderr", async () => {
		const promise = sshOk("dev", "false", {}, spawnImpl);
		child.emitStderr("permission denied");
		child.emitClose(1);

		await expect(promise).rejects.toThrow(/SSH failed \(1\): permission denied/);
	});

	it("surfaces stdout when stderr is empty", async () => {
		const promise = sshOk("dev", "false", {}, spawnImpl);
		child.emitStdout("some stdout");
		child.emitClose(1);

		await expect(promise).rejects.toThrow(/SSH failed \(1\): some stdout/);
	});

	it("uses 'unknown ssh error' when both streams are empty", async () => {
		const promise = sshOk("dev", "false", {}, spawnImpl);
		child.emitClose(1);

		await expect(promise).rejects.toThrow(/unknown ssh error/);
	});
});

describe("inferImageMimeType", () => {
	it("returns image/jpeg for .jpg and .jpeg", () => {
		expect(inferImageMimeType("/a/b/c.jpg")).toBe("image/jpeg");
		expect(inferImageMimeType("/a/b/c.jpeg")).toBe("image/jpeg");
	});

	it("returns image/png for .png", () => {
		expect(inferImageMimeType("/a/b/c.png")).toBe("image/png");
	});

	it("returns image/webp for .webp", () => {
		expect(inferImageMimeType("/a/b/c.webp")).toBe("image/webp");
	});

	it("returns image/gif for .gif", () => {
		expect(inferImageMimeType("/a/b/c.gif")).toBe("image/gif");
	});

	it("returns null for unknown extensions", () => {
		expect(inferImageMimeType("/a/b/c.txt")).toBeNull();
		expect(inferImageMimeType("/a/b/c")).toBeNull();
	});
});

describe("createRemoteBashOps", () => {
	let child: FakeChild;
	let spawnImpl: SshSpawn;

	beforeEach(() => {
		child = new FakeChild();
		spawnImpl = fakeSpawn(child);
	});

	it("wraps the command in `cd <cwd>` and pipes to bash -se", async () => {
		const ops = createRemoteBashOps({ name: "dev", remote: "dev", remoteCwd: "/var/www" }, spawnImpl);
		const promise = ops.exec("ls -la", "/var/www", { onData: () => {} });
		child.emitClose(0);

		const { exitCode } = await promise;
		expect(exitCode).toBe(0);
		const stdinText = child.written.map((b) => b.toString()).join("");
		expect(stdinText).toContain("cd '/var/www'");
		expect(stdinText).toContain("ls -la");
	});

	it("forwards onData to both stdout and stderr handlers", async () => {
		const onData = vi.fn();
		const ops = createRemoteBashOps({ name: "dev", remote: "dev", remoteCwd: "/var/www" }, spawnImpl);
		const promise = ops.exec("cmd", "/var/www", { onData });
		child.emitStdout("out");
		child.emitStderr("err");
		child.emitClose(0);

		await promise;
		expect(onData).toHaveBeenCalledWith(Buffer.from("out"));
		expect(onData).toHaveBeenCalledWith(Buffer.from("err"));
	});
});
