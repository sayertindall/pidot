/**
 * pi-process extension registry.
 *
 * Bundles all pi-process sub-extensions into one package:
 *   - pi-dispatch — PTY-based dispatch engine
 *   - pi-herdr    — Herdr layout & pane management
 *   - pi-ssh      — Explicit SSH command execution
 *   - pi-tmux     — tmux pane/session wrapper
 *
 * Each sub-extension lives in its own subdirectory. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piDispatchExtensions from "./pi-dispatch/index.js";
import piHerdrExtensions from "./pi-herdr/index.js";
import piSshExtensions from "./pi-ssh/index.js";
import piTmuxExtensions from "./pi-tmux/index.js";

export default function piProcessExtensions(pi: ExtensionAPI): void {
	piDispatchExtensions(pi);
	piHerdrExtensions(pi);
	piSshExtensions(pi);
	piTmuxExtensions(pi);
}
