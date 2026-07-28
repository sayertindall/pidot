/**
 * pi-dispatch extension registry.
 *
 * One extension today (`shell`). Pure wiring — no logic, no state. If a
 * second extension shows up later, this is where it gets registered.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import shell from "./shell/index";

export default function piDispatchExtensions(pi: ExtensionAPI): void {
	shell(pi);
}
