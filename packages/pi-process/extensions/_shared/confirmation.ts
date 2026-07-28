/**
 * _shared/confirmation.ts
 *
 * Explicit-confirmation prompt helper for high-privilege commands.
 * pi-ssh is the only consumer for now; the helper lives in _shared
 * because v3 calls this out as a pattern any high-privilege
 * command should adopt.
 *
 * The helper is dependency-injected (no direct import of pi's UI),
 * so it's testable without a real prompt: tests pass a `Confirm`
 * that returns true/false at will.
 */

export type Confirm = (prompt: string) => Promise<boolean>;

export class ConfirmationDeclinedError extends Error {
	constructor(public readonly reason: string, public readonly prompt: string) {
		super(`Confirmation declined: ${reason}`);
		this.name = "ConfirmationDeclinedError";
	}
}

/**
 * Ask the user to confirm `prompt`. Throws `ConfirmationDeclinedError`
 * if the user declines; resolves otherwise. Caller is responsible
 * for surfacing the prompt to the user (via pi's UI, etc.).
 */
export async function confirmOrThrow(
	reason: string,
	prompt: string,
	confirm: Confirm,
): Promise<void> {
	const ok = await confirm(prompt);
	if (!ok) {
		throw new ConfirmationDeclinedError(reason, prompt);
	}
}
