/**
 * pi-process-shared
 *
 * Cross-cutting helpers used by the pi-process extensions. Every
 * extension in `packages/pi-process/` (pi-tmux, pi-ssh, pi-shell, pi-herdr)
 * imports from here when it needs:
 *
 * - `safeExec` — the only subprocess-call surface in the package
 *   (execFileSync + timeout + maxBuffer, no `shell: true`).
 * - `toTerminalStatus` — the 4-state completion contract every harness
 *   in SUB-SPEC-v3 maps onto.
 * - RunRecord helpers — atomic, corruption-move-backed persistence of
 *   dispatch state for crash recovery.
 * - `confirmOrThrow` — explicit-confirmation prompt helper for
 *   high-privilege commands.
 * - `paths` — `~/.pi/agent/pi-process/*` layout.
 *
 * Adding a helper here requires it to be used by at least two
 * extensions. Single-extension helpers live in the extension's own
 * directory.
 */

export * from "./safe-exec";
export * from "./terminal-status";
export * from "./run-record";
export * from "./confirmation";
export * from "./paths";
