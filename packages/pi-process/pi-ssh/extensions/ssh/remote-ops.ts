/**
 * pi-ssh/remote-ops.ts
 *
 * Subprocess execution against an SSH target plus the
 * `BashOperations` / `EditOperations` / `ReadOperations` /
 * `WriteOperations` factory functions that wire the SDK's
 * read/write/edit/bash tools to the remote host.
 *
 * The `sshExec` helper is a thin wrapper over `node:child_process`
 * that adds: timeout, AbortSignal, stdin, streaming stdout/stderr
 * callbacks. Tests inject a fake `execImpl` instead of mocking
 * the child_process layer.
 *
 * NOTE on safeExec: the spec family's `_shared/safe-exec.ts`
 * doesn't fit SSH's streaming use case (no stdin, no onData
 * callbacks, no signal-aware cancellation). The `sshExec` helper
 * here is the SSH-specific pattern; if safeExec grows streaming
 * support later, this can fold into it.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { extname } from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type BashOperations,
	type EditOperations,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { shellQuote } from "./path-utils";
import { toLocalEditPath, toRemotePath } from "./path-utils";
import type { ActiveSshTarget, SshExecOptions, SshExecResult } from "./types";

/**
 * The subprocess spawn signature. Tests inject a fake. The
 * default (when not provided) is the real `spawn` from
 * `node:child_process`.
 */
export type SshSpawn = (
	command: string,
	args: readonly string[],
	options: { stdio: [import("node:stream").Writable | null, ...import("node:stream").Readable[]] },
) => ChildProcessWithoutNullStreams;

/**
 * Run `ssh <remote> <command>` and return the result.
 *
 * Honors timeout, AbortSignal, and streaming callbacks. Throws
 * `Error("aborted")` if the signal fires, `Error("timeout:N")`
 * on timeout, or the underlying spawn error otherwise.
 */
export async function sshExec(
	remote: string,
	command: string,
	options: SshExecOptions = {},
	spawnImpl: SshSpawn = spawn as unknown as SshSpawn,
): Promise<SshExecResult> {
	return new Promise((resolve, reject) => {
		// Cast through unknown: spawnImpl's runtime signature is
		// child_process's spawn, but our SshSpawn type narrows the
		// third arg's stdio tuple to keep the contract testable. The
		// underlying spawn accepts "pipe" strings just fine.
		const child = (spawnImpl as unknown as typeof spawn)(
			"ssh",
			[remote, command],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;
		const timer =
			typeof options.timeoutSeconds === "number" && options.timeoutSeconds > 0
				? setTimeout(() => {
						timedOut = true;
						child.kill();
					}, options.timeoutSeconds * 1000)
				: undefined;

		const cleanup = () => {
			if (timer) clearTimeout(timer);
			if (options.signal) options.signal.removeEventListener("abort", onAbort);
		};

		const onAbort = () => {
			child.kill();
		};

		child.stdout.on("data", (data: Buffer) => {
			stdoutChunks.push(data);
			options.onStdoutData?.(data);
		});
		child.stderr.on("data", (data: Buffer) => {
			stderrChunks.push(data);
			options.onStderrData?.(data);
		});
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (exitCode) => {
			cleanup();
			if (options.signal?.aborted) {
				reject(new Error("aborted"));
				return;
			}
			if (timedOut) {
				reject(new Error(`timeout:${options.timeoutSeconds}`));
				return;
			}
			resolve({
				stdout: Buffer.concat(stdoutChunks),
				stderr: Buffer.concat(stderrChunks),
				exitCode,
			});
		});

		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		if (options.stdin !== undefined) {
			child.stdin.write(options.stdin);
		}
		child.stdin.end();
	});
}

/**
 * Run an SSH command; throw on nonzero exit. Returns stdout.
 */
export async function sshOk(
	remote: string,
	command: string,
	options: SshExecOptions = {},
	spawnImpl?: SshSpawn,
): Promise<Buffer> {
	const { stdout, stderr, exitCode } = await sshExec(remote, command, options, spawnImpl);
	if (exitCode !== 0) {
		const errorText = stderr.toString("utf8").trim() || stdout.toString("utf8").trim() || "unknown ssh error";
		throw new Error(`SSH failed (${exitCode}): ${errorText}`);
	}
	return stdout;
}

/**
 * Resolve the remote cwd for an SshProfile. Uses the profile's
 * `cwd` if set, otherwise shells out to `pwd` on the remote.
 */
export async function resolveRemoteCwd(
	profile: { remote: string; cwd?: string },
	spawnImpl?: SshSpawn,
): Promise<string> {
	if (profile.cwd?.trim()) {
		return profile.cwd.trim();
	}
	return (await sshOk(profile.remote, "pwd", {}, spawnImpl)).toString("utf8").trim();
}

/**
 * Image MIME type detection. Limited to common formats; returns
 * null for anything else (the SDK then treats the file as text).
 */
export function inferImageMimeType(path: string): string | null {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return null;
	}
}

export function createRemoteReadOps(
	target: ActiveSshTarget,
	spawnImpl?: SshSpawn,
): ReadOperations {
	return {
		readFile: (absolutePath) => sshOk(target.remote, `cat ${shellQuote(absolutePath)}`, {}, spawnImpl),
		access: (absolutePath) =>
			sshOk(target.remote, `test -r ${shellQuote(absolutePath)}`, {}, spawnImpl).then(() => undefined),
		detectImageMimeType: async (absolutePath) => inferImageMimeType(absolutePath),
	};
}

export function createRemoteWriteOps(
	target: ActiveSshTarget,
	spawnImpl?: SshSpawn,
): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			await sshOk(target.remote, `cat > ${shellQuote(absolutePath)}`, { stdin: content }, spawnImpl);
		},
		mkdir: (dir) => sshOk(target.remote, `mkdir -p ${shellQuote(dir)}`, {}, spawnImpl).then(() => undefined),
	};
}

export function createRemoteEditOps(
	target: ActiveSshTarget,
	localCwd: string,
	spawnImpl?: SshSpawn,
): EditOperations {
	const remotePath = (path: string) => toRemotePath(path, localCwd, target.remoteCwd);
	return {
		readFile: (absolutePath) => sshOk(target.remote, `cat ${shellQuote(remotePath(absolutePath))}`, {}, spawnImpl),
		writeFile: async (absolutePath, content) => {
			await sshOk(target.remote, `cat > ${shellQuote(remotePath(absolutePath))}`, { stdin: content }, spawnImpl);
		},
		access: (absolutePath) => {
			const path = remotePath(absolutePath);
			return sshOk(target.remote, `test -r ${shellQuote(path)} && test -w ${shellQuote(path)}`, {}, spawnImpl).then(
				() => undefined,
			);
		},
	};
}

export function createRemoteBashOps(
	target: ActiveSshTarget,
	spawnImpl?: SshSpawn,
): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			const script = `cd ${shellQuote(cwd)}\n${command}\n`;
			const { exitCode } = await sshExec(
				target.remote,
				"exec bash -se",
				{
					stdin: script,
					signal,
					timeoutSeconds: timeout,
					onStdoutData: onData,
					onStderrData: onData,
				},
				spawnImpl,
			);
			return { exitCode };
		},
	};
}

// Re-export tool-definition factories from the SDK so callers
// don't need a direct dependency on the SDK.
export {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
};

// Re-export toLocalEditPath for callers that need it (the
// extension factory uses it to translate model-supplied paths
// before delegating to the SDK's edit tool).
export { toLocalEditPath };

export type { SshExecOptions };
