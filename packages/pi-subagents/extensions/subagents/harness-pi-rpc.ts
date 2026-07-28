/**
 * harness-pi-rpc.ts
 *
 * Out-of-process subagent harness. Delegates to socket-harness.ts
 * (session-control Unix socket transport) instead of implementing
 * stdio-based RPC. The socket approach gives crash isolation, push
 * notifications via result_ready events, and cross-machine capability.
 *
 * See docs/specs/subagent-socket-transport.md for the full spec.
 */

import type { PiRpcLaunchConfig, HarnessResult } from "./types";
import { runViaSocket } from "./harness/socket-harness";

export async function runViaPiRpc(launch: PiRpcLaunchConfig): Promise<HarnessResult> {
	return runViaSocket(launch);
}
