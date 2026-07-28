/**
 * run-id.ts — Simple run ID generator
 */

import { randomBytes } from "node:crypto";

export function generateRunId(): string {
	return randomBytes(12).toString("hex");
}
