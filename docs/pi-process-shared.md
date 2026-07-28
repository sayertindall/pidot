# pi-process-shared

Cross-cutting helpers used by two or more pi-process extensions.

## Modules

### safeExec

The only subprocess-call surface in pi-process. Every `exec*` call in pi-tmux,
pi-ssh, and pi-dispatch routes through here.

**Discipline:**
- `execFileSync(command, args, { timeout, maxBuffer, cwd, env })`
- No `shell: true`. Args always an array.
- Hard timeout enforced.
- `maxBuffer` bounded; overflow throws `SafeExecError`.
- Nonzero exit throws; caller decides whether to surface stderr.
- Spawn failure (ENOENT, etc.) throws with the underlying cause.

### confirmation

Explicit-confirmation prompt helper for high-privilege commands. Dependency-injected
so tests can pass a `Confirm` function without a real prompt.

### RunRecord

Process run auditing. Records command, args, exit code, timing, and serialization
round-trips for pi-dispatch's persistent audit trail.

### paths

State file layout under `~/.pi/agent/pi-process/`:
- `pi-tmux/` — tmux state
- `pi-ssh/` — SSH profiles, known hosts
- `pi-dispatch/` — run records, config
- `pi-herdr/` — herdr state

## Exports

| Export | Description |
|---|---|
| `safeExec` | Execute subprocess with safety discipline |
| `SafeExecError` | Typed error for safeExec failures |
| `SafeExecResult` | Result type (stdout, stderr, exitCode, signal, durationMs) |
| `SafeExecCause` | Error cause: `"nonzero_exit"`, `"timeout"`, `"maxbuffer"`, `"spawn"` |
| `confirmOrThrow` | Confirmation helper with timeout/cancel |
| `ConfirmationDeclinedError` | Typed error for declined confirmations |
| `PI_PROCESS_BASE` | `~/.pi/agent/pi-process/` path |
| `extensionDir` | Per-extension state directory |

## Testing

- Dependency injection pattern: `runtime.ts` modules accept a `safeExecImpl` parameter defaulting to the real impl
- Tests pass stubs matching the `SafeExecResult` type
- Follows the "binary-call mock, not process mock" rule
