/**
 * pi-tmux extension registry.
 *
 * Pure wiring — imports the tmux extension factory and
 * registers it with the Pi ExtensionAPI. This is the only
 * file in the `extensions/` directory that is not inside
 * a per-extension subdirectory.
 */
import piTmux from "./tmux/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piTmuxExtensions(pi: ExtensionAPI): void {
	piTmux(pi);
}
