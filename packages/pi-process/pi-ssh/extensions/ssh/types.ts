/**
 * pi-ssh/types.ts
 *
 * Public types for the SSH delegation extension.
 *
 * The extension is shaped around an "active SSH target" (one at a
 * time). When SSH mode is on, four read/write/edit/bash tools
 * route through that target's remote host instead of the local
 * filesystem.
 */

export type SshProfile = {
	name: string;
	remote: string;
	cwd?: string;
};

export type ActiveSshTarget = {
	name: string;
	remote: string;
	remoteCwd: string;
};

export type SshExecResult = {
	stdout: Buffer;
	stderr: Buffer;
	exitCode: number | null;
};

export type SshExecOptions = {
	stdin?: string | Buffer;
	signal?: AbortSignal;
	onStdoutData?: (data: Buffer) => void;
	onStderrData?: (data: Buffer) => void;
	timeoutSeconds?: number;
};
