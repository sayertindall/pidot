/**
 * shell/sentinel.ts
 *
 * The completion marker is printed by the shell, not embedded in the
 * prompt. Old design (and an earlier draft of the pi-dispatch spec) put the
 * marker inside the child's prompt text. Two bugs: nothing actually told
 * the child to print it, and if it had, a CLI that echoes its own received
 * prompt back to its UI produces a false-positive completion the instant it
 * renders. Fix: wrap the *command*, print the marker from the shell after
 * the child exits, using a literal that only exists once the format string
 * is filled in at runtime — so it can never appear in the argv the child
 * renders.
 */

const SENTINEL_RE = /rc=(-?\d+)___$/;

export function sentinelLiteral(recordId: string, launchToken: string): string {
	return `___PI_DONE_${recordId}_${launchToken}_rc=`;
}

export function sentinelPrefix(recordId: string, launchToken: string): string {
	return `___PI_DONE_${recordId}_${launchToken}_`;
}

/**
 * Wrap `inner` (the raw command to run) so the shell prints a completion
 * marker with the real exit code after it finishes, regardless of whether
 * `inner` itself exits cleanly, is killed, or crashes the shell's own
 * expression. Also recovers the true exit code for PTY-hosted TUIs that
 * otherwise report exitCode: null.
 */
export function wrapForSentinel(inner: string, recordId: string, launchToken: string): string {
	const prefix = sentinelPrefix(recordId, launchToken);
	if (process.platform === "win32") {
		return `cmd /c "(${inner}) & echo ${prefix}rc=%ERRORLEVEL%___"`;
	}
	return `{ ${inner} ; }; __pi_rc=$?; printf '\\n${prefix}rc=%s___\\n' "$__pi_rc"`;
}

/**
 * Scan a chunk of terminal output for the sentinel. Returns the parsed
 * exit code on a match, or undefined if the sentinel hasn't appeared yet.
 */
export function findSentinel(output: string, recordId: string, launchToken: string): number | undefined {
	const prefix = sentinelPrefix(recordId, launchToken);
	const idx = output.lastIndexOf(prefix);
	if (idx === -1) return undefined;
	const tail = output.slice(idx + prefix.length, idx + prefix.length + 32);
	const match = tail.match(SENTINEL_RE) ?? tail.match(/^rc=(-?\d+)___/);
	if (!match) return undefined;
	const rc = Number.parseInt(match[1] ?? "", 10);
	return Number.isNaN(rc) ? undefined : rc;
}

/**
 * Fallback for CLIs that never exit on their own (interactive REPLs): a
 * prompt-embedded marker is still supported, but the caller must state an
 * expected occurrence count and match on the k+1th occurrence, not the
 * first — closing the echo-vulnerability hole there too, since the child
 * echoing the received prompt back produces exactly one occurrence.
 */
export function findNthOccurrence(output: string, literal: string, occurrence: number): number | undefined {
	let index = -1;
	for (let i = 0; i < occurrence; i++) {
		index = output.indexOf(literal, index + 1);
		if (index === -1) return undefined;
	}
	return index;
}
