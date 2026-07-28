# pi-process

Process, pane, and native-CLI-delegation orchestration for the Pi coding agent. The package owns every "safely talk to an external process" client: tmux, herdr, SSH, and the structured-dispatch interface pi-subagents uses to delegate work to other CLIs.

## Layout

```
packages/pi-process/
├── _shared/           # pi-process-shared: safeExec, TerminalStatus, RunRecord, confirmation, paths
├── pi-tmux/           # thin tmux wrapper (scaffold)
├── pi-ssh/            # explicit SSH command execution (scaffold)
├── pi-shell/          # from-scratch interactive shell rewrite (SPEC.md only, work paused)
├── pi-shell-old/      # pi-interactive-shell reference (read-only oracle)
└── pi-herdr/          # vendored model-invoked Herdr tools (already implemented)
```

Each subdirectory is a self-contained npm package with its own `package.json`, `tsconfig.json`, and `vitest.config.ts`.

## Design

Per `PI-PROCESS-IMPL-SPEC.md` and `PER-PACKAGE-SPECS-v3.md §"pi-process"`:

- **`_shared/`** — cross-cutting helpers used by two or more extensions. Single-extension helpers live in the extension's own directory.
- **`pi-tmux/`** — thin wrapper over `pi.exec("tmux", ...)`. Tmux is the state; this is the command surface. No widget.
- **`pi-ssh/`** — explicit SSH command execution. Confirmation required, every invocation logged. State under `~/.pi/agent/pi-process/pi-ssh/`.
- **`pi-shell/`** — from-scratch rewrite of the interactive shell (work paused; see `SPEC.md`).
- **`pi-herdr/`** — vendored from `libs/pi-extensions/packages/pi-herdr`. Three model-invoked tools gated on `HERDR_ENV=1` + `HERDR_PANE_ID`. Not a pi-subagents harness.

## Installation

Each subdirectory is its own npm package. Install individually:

```sh
pi install ./packages/pi-process/pi-tmux
pi install ./packages/pi-process/pi-ssh
pi install ./packages/pi-process/pi-herdr
```

## Status

`_shared/`, `pi-tmux/`, `pi-ssh/` are scaffolds: directory structure, package config, type signatures, and one passing test per file. Implementation per `PI-PROCESS-IMPL-SPEC.md` follows.

`pi-herdr/` is the existing vendored implementation, untouched.

`pi-shell/` is paused; `SPEC.md` is the only file there. `pi-shell-old/` is the reference (do not edit).
