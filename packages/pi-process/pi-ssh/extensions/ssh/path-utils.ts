/**
 * pi-ssh/path-utils.ts
 *
 * Path translation between the local SSH edit workspace and the
 * active remote working directory. Pure functions — no I/O.
 *
 * The translation rules:
 * - `toLocalEditPath`: convert a remote path (from the agent's
 *   perspective) into the local path that the SDK's edit tool
 *   understands. Absolute remote paths are made relative to
 *   `remoteCwd`; tilde paths are rejected.
 * - `toRemotePath`: convert a local path (used by the edit tool)
 *   into the absolute remote path. Local paths must be inside
 *   `localCwd`; the resulting remote path is rooted at `remoteCwd`.
 */

import { isAbsolute, relative, sep } from "node:path";

/**
 * Shell-quote a single argument for embedding in a remote
 * command. POSIX `sh` style: single-quote-wrap, escape embedded
 * single quotes via the standard `'"'"'` trick.
 */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Normalize a remote path: drop trailing slashes (except for root).
 */
export function normalizeRemoteDir(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Convert a remote path to a path relative to `remoteCwd`.
 * Throws if the path is not under `remoteCwd`.
 */
export function remoteRelativePath(path: string, remoteCwd: string): string {
	const normalizedCwd = normalizeRemoteDir(remoteCwd);
	if (path === normalizedCwd) {
		return ".";
	}
	if (!path.startsWith(`${normalizedCwd}/`)) {
		throw new Error(
			`Remote path ${path} is outside the active SSH working directory ${remoteCwd}. Use a relative path or switch SSH mode to that directory.`,
		);
	}
	return path.slice(normalizedCwd.length + 1);
}

/**
 * Translate a remote path (from the model's perspective) to a
 * local path that the SDK's edit tool will treat as the file to
 * edit. Absolute paths become relative to `remoteCwd`; tilde
 * paths are rejected.
 */
export function toLocalEditPath(path: string, remoteCwd: string): string {
	if (path.startsWith("~/")) {
		throw new Error("ssh_edit does not expand ~ paths. Use a path relative to the SSH working directory instead.");
	}
	if (isAbsolute(path)) {
		return remoteRelativePath(path, remoteCwd);
	}
	return path;
}

/**
 * Translate a local path (from the SDK's edit tool's perspective)
 * to the absolute remote path that will actually be read/written.
 * `localCwd` is the local cwd of the edit-tool worker; the
 * translated path is rooted at `remoteCwd`.
 */
export function toRemotePath(path: string, localCwd: string, remoteCwd: string): string {
	const relativePath = relative(localCwd, path).split(sep).join("/");
	if (relativePath.startsWith("../") || relativePath === "..") {
		throw new Error(`Resolved edit path ${path} escaped the local SSH edit workspace.`);
	}
	if (!relativePath || relativePath === ".") {
		return remoteCwd;
	}
	return `${normalizeRemoteDir(remoteCwd)}/${relativePath}`;
}
