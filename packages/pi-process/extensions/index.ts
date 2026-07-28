/**
 * pi-process extension registry.
 *
 * Bundles all pi-process sub-extensions into one package:
 *   - pi-dispatch — PTY-based dispatch engine
 *   - pi-herdr    — Herdr layout & pane management
 *   - pi-ssh      — Explicit SSH command execution
 *   - pi-tmux     — tmux pane/session wrapper
 *
 * Each sub-extension lives in its own subdirectory with its own
 * node_modules (so link: deps like pi-process-shared still resolve).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piDispatchExtensions from "../pi-dispatch/extensions/index";
import piHerdrExtensions from "../pi-herdr/extensions/index";
import piSshExtensions from "../pi-ssh/extensions/index";
import piTmuxExtensions from "../pi-tmux/extensions/index";

export default function piProcessExtensions(pi: ExtensionAPI): void {
	piDispatchExtensions(pi);
	piHerdrExtensions(pi);
	piSshExtensions(pi);
	piTmuxExtensions(pi);
}
