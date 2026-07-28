/** Check whether an unknown error carries the ENOENT code. */
export function isEnoent(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as Record<string, unknown>).code === "ENOENT"
	);
}
