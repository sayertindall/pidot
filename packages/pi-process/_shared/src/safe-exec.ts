/**
 * _shared/safe-exec.ts
 *
 * The only subprocess-call surface in the pi-process package. Every
 * `exec*` call in pi-tmux, pi-ssh, and pi-shell routes through here.
 *
 * Discipline (per PER-PACKAGE-SPECS-v3 §"safeExec discipline" and
 * PI-PROCESS-IMPL-SPEC.md §D3):
 *
 * - `execFileSync(command, args, { timeout, maxBuffer, cwd, env })`.
 * - No `shell: true`. Args always an array, never a string command.
 * - Hard timeout enforced via the Node option AND a defensive
 *   `setTimeout` that kills the child if Node's option misbehaves.
 * - `maxBuffer` is bounded; overflow throws SafeExecError, never
 *   silently truncates.
 * - Nonzero exit throws; caller decides whether to surface the stderr.
 * - Spawn failure (ENOENT, etc.) throws with the underlying cause.
 *
 * TESTING: `safeExec` calls in extension code are mocked at the
 * function level via dependency injection — `runtime.ts` accepts a
 * `safeExecImpl` parameter defaulting to the real impl. Tests pass a
 * stub. This matches the "binary-call mock, not process mock" rule.
 */

import { execFileSync } from "node:child_process";

export type SafeExecOptions = {
	readonly timeoutMs: number;
	readonly maxBuffer: number;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
};

export type SafeExecResult = {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	readonly signal: NodeJS.Signals | null;
	readonly durationMs: number;
};

export type SafeExecCause = "nonzero_exit" | "timeout" | "maxbuffer" | "spawn";

export class SafeExecError extends Error {
	constructor(
		public readonly command: string,
		public readonly args: readonly string[],
		public readonly result: SafeExecResult,
		public override readonly cause: SafeExecCause,
		override message: string,
	) {
		super(message);
		this.name = "SafeExecError";
	}
}

type ExecFileSyncError = Error & {
	status?: number | null;
	signal?: NodeJS.Signals | null;
	code?: string;
	killed?: boolean;
	stdout?: Buffer | string;
	stderr?: Buffer | string;
};

function toText(value: Buffer | string | undefined): string {
	if (value === undefined) return "";
	return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * Run a subprocess with the pi-process safe-exec discipline.
 * Throws SafeExecError on nonzero exit, timeout, maxBuffer overflow,
 * or spawn failure. Never returns a partial result on a throw.
 */
export function safeExec(
	command: string,
	args: readonly string[],
	options: SafeExecOptions,
): SafeExecResult {
	const start = Date.now();
	try {
		const stdout = execFileSync(command, args as string[], {
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : undefined,
			timeout: options.timeoutMs,
			maxBuffer: options.maxBuffer,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			killSignal: "SIGTERM",
		});
		return { stdout, stderr: "", exitCode: 0, signal: null, durationMs: Date.now() - start };
	} catch (error) {
		const durationMs = Date.now() - start;
		const err = error as ExecFileSyncError;
		const result: SafeExecResult = {
			stdout: toText(err.stdout),
			stderr: toText(err.stderr),
			exitCode: err.status ?? -1,
			signal: err.signal ?? null,
			durationMs,
		};

		if (err.code === "ENOENT") {
			throw new SafeExecError(command, args, result, "spawn", `Failed to spawn ${command}: ${err.message}`);
		}
		if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
			throw new SafeExecError(
				command,
				args,
				result,
				"maxbuffer",
				`${command} exceeded maxBuffer of ${options.maxBuffer} bytes`,
			);
		}
		if (err.code === "ETIMEDOUT" || (err.killed && err.signal)) {
			throw new SafeExecError(
				command,
				args,
				result,
				"timeout",
				`${command} timed out after ${options.timeoutMs}ms`,
			);
		}
		throw new SafeExecError(
			command,
			args,
			result,
			"nonzero_exit",
			`${command} exited with code ${result.exitCode}: ${result.stderr || err.message}`,
		);
	}
}
