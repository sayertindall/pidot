# Subagent Persistence — Spec

**Status**: Implemented · **Date**: 2025-07-27 · **Depends on**: subagent-socket-transport (Phase 2), ledger.ts (done), parent-key.ts (done)

## 1. Goal

Subagents survive crashes, reloads, and restarts. A parent session that goes
down can reconnect to running children when it comes back up. A parent that
restarts the next day can collect results from children that finished while
it was gone.

No polling. No broker. No database. Just files on disk and the session-control
socket directory.

## 2. Current State

Today, in-process subagents are part of the parent's session file. They survive
`/reload` because the tool result is in the transcript. But they have zero
independence — parent crash = subagent dead.

Socket-based subagents (Phase 2) are separate processes. Child crash doesn't
touch parent. But the parent needs a way to remember it has children out there,
especially across restarts.

## 3. Design

### 3.1 The Ledger

Parent writes every spawn to `~/.pi/agent/pi-subagents/ledger.jsonl`:

```jsonl
{"parentSessionId":"abc123","childSessionId":"def456","runId":"run-001","agentName":"finder","task":"locate auth code","harness":"socket","spawnedAt":1700000000000,"status":"running"}
{"parentSessionId":"abc123","childSessionId":"ghi789","runId":"run-002","agentName":"worker","task":"refactor auth.ts","harness":"socket","spawnedAt":1700000001000,"status":"running"}
```

One line per spawn. Written at spawn time, updated at completion. Append-only —
never rewrite the file, only append status change lines for the same `runId`.
On read, take the last line per `runId`.

### 3.2 Result Artifacts

Child writes its result to `~/.pi/agent/pi-subagents/results/<runId>.json`:

```json
{
  "runId": "run-001",
  "parentSessionId": "abc123",
  "childSessionId": "def456",
  "agentName": "finder",
  "status": "completed",
  "output": "Auth code is in src/auth.ts. The middleware chain is in src/middleware/auth.ts.",
  "toolCount": 12,
  "turnCount": 3,
  "tokenUsage": {
    "input": 45000,
    "output": 3200,
    "cacheCreation": 0,
    "cacheRead": 0
  },
  "error": null,
  "modelUsed": "anthropic/claude-sonnet-4",
  "spawnedAt": 1700000000000,
  "completedAt": 1700000030000
}
```

This is the **canonical result**. The `result_ready` event is an optimization
for the live case — but the file is the source of truth.

Child writes this file in `subagent-runner.ts` immediately after capturing the
result, BEFORE emitting `result_ready`. Write-then-emit ordering ensures the
file exists before any subscriber can read it.

### 3.3 Reconciliation

On `session_start`, the parent runs reconciliation:

```
reconcilePersistedChildren(ctx):
  1. Read ledger.jsonl
     → group by runId, take last status per runId
     → filter: parentSessionId === this session's ID

  2. For each "running" child:
     a. Check socket liveness:
        → getSocketPath(childSessionId)
        → isSocketAlive()

     b. If socket alive:
        → subscribe to result_ready
        → re-establish connection (child kept running)
        → update in-memory state

     c. If socket dead:
        → check results/<runId>.json
        → exists? collect result, mark ledger "completed"
        → missing? mark ledger "crashed"

  3. For each "completed" child:
     → check if parent already collected this result
        (compare result's runId against collected-run-ids in parent state)
     → if not collected: inject result into session as system message

  4. For each "crashed" child:
     → inject as system message: "Subagent 'finder' (run-001) crashed.
        Last known socket: dead. No result artifact found.
        Task was: locate auth code"
```

### 3.4 Collected Result Tracking

Parent tracks which results it has already seen. Stored in
`~/.pi/agent/pi-subagents/collected.json`:

```json
{
  "abc123": ["run-001", "run-003", "run-007"]
}
```

Keyed by parent session ID. Prevents duplicate injection on repeated restarts.

### 3.5 Cleanup Policy

| Artifact                                       | When cleaned               | By whom                                                  |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `results/<runId>.json`                         | 7 days after `completedAt` | GC in parent's session_start (or dedicated cleanup)      |
| Dead socket                                    | 1 hour after process death | session-control periodic GC (§12 in integration spec)    |
| Ledger entries marked "completed" or "crashed" | 7 days after status change | Same GC pass                                             |
| `collected.json` entries                       | Never (grows slowly, tiny) | Manual cleanup only                                      |
| `results/<runId>.json.dead`                    | 7 days after creation      | Same GC pass (mailbox.dead pattern from session-control) |

### 3.6 Orphan Policy

When the parent exits, what happens to running children?

| Policy           | Behavior                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kill` (default) | Parent kills all running children on `session_shutdown`. Sends `abort` over socket, then SIGTERM via dispatch.               |
| `detach`         | Parent writes ledger entry with `orphaned: true`. Children keep running. On next parent start, reconciliation picks them up. |

`orphan: "detach"` is useful for long-running subagent tasks (test suites,
large refactors) where the user intentionally quits the parent and wants
results later.

Set per-subagent: `subagent({ ..., orphan: "detach" })`. Default is `"kill"`
for backward compatibility — today's subagents die with the parent.

## 4. Files on Disk

```
~/.pi/agent/pi-subagents/
├── ledger.jsonl              ← parent writes spawns + status changes
├── collected.json            ← parent tracks which results it has seen
├── results/
│   ├── run-001.json          ← child writes result before emitting event
│   ├── run-002.json
│   ├── run-003.json.dead     ← moved here after parent collected (GC later)
│   └── ...
└── state.json                ← optional: in-memory index cache for fast lookup
```

## 5. Scenarios

### 5.1 Happy Path

```
1. Parent spawns child via socket harness
2. Parent writes ledger: run-001 → running
3. Child runs, writes results/run-001.json
4. Child emits result_ready
5. Parent receives event, collects result inline
6. Parent writes ledger: run-001 → completed
7. Parent adds run-001 to collected.json
8. GC later: moves results/run-001.json → results/run-001.json.dead
```

### 5.2 Parent Crash, Child Keeps Running

```
1. Parent spawns child via socket harness
2. Parent writes ledger: run-001 → running
3. Parent crashes (kill -9)
4. Child keeps running, finishes task
5. Child writes results/run-001.json
6. Child emits result_ready (nobody listening)
7. Child exits
8. Socket dies
9. --- time passes ---
10. User restarts parent session
11. session_start → reconcilePersistedChildren()
12. Finds ledger: run-001 → running
13. Child socket dead, results/run-001.json exists
14. Parent injects: "Subagent 'finder' completed while you were away:
    <output>"
15. Parent marks ledger: run-001 → completed
```

### 5.3 Parent Reloads Mid-Subagent

```
1. Parent spawns child via socket harness
2. Parent writes ledger: run-001 → running
3. Child is mid-task (tool call in progress)
4. User types /reload in parent
5. Parent session reloads
6. session_start → reconcilePersistedChildren()
7. Child socket alive → subscribe to result_ready, reconnect
8. Child finishes, result_ready fires
9. Parent collects result (live path, same as happy path)
```

### 5.4 Both Crash

```
1. Parent spawns child via socket harness
2. Parent writes ledger: run-001 → running
3. Machine dies (power loss)
4. On reboot:
   - Child session file exists (session manager persists)
   - results/run-001.json: NOT found (child didn't finish)
   - Child socket: dead
5. Parent starts, reconciliation finds run-001 → running + no socket + no result
6. Parent marks ledger: run-001 → crashed
7. Parent injects: "Subagent 'finder' (run-001) crashed before completing.
   Task was: locate auth code. No results available."
```

### 5.5 Orphaned Child with detach Policy

```
1. Parent spawns child: subagent({ ..., orphan: "detach" })
2. Parent writes ledger: run-001 → running
3. Parent exits normally (user quits)
4. session_shutdown: orphan policy is "detach" → skip kill
5. Child keeps running
6. Child finishes, writes results/run-001.json
7. Child exits
8. --- next day ---
9. Parent starts fresh session (new session ID)
10. But ledger entry has old parentSessionId → reconciliation skips it
```

**This is a problem.** An orphaned child with a different parent session ID
can't be reconnected. The fix: parent stores a **session key** that survives
across sessions.

### 5.6 Cross-Session Parent Tracking

The `parentSessionId` in the ledger is a **session key**, not the literal
session ID. The session key is stored in `~/.pi/agent/pi-subagents/parent-key`:

```
abc123-def456-789   ← a random persistent key, written once
```

On `session_start`, the parent reads its key file. If it doesn't exist,
generate one. The key survives session restarts because it's in the filesystem,
not in the session file.

```jsonl
{"parentKey":"abc123-def456-789","childSessionId":"def456","runId":"run-001",...}
```

Reconciliation uses `parentKey`, not `parentSessionId`. This means a parent
that restarts with a fresh session can still find its orphaned children.

## 6. New Module: ledger.ts

Lives in `pi-subagents/extensions/subagents/ledger.ts`.

```typescript
// ledger.ts — public API

/** Write a spawn to the ledger. */
export function writeSpawn(entry: LedgerSpawnEntry): Promise<void>;

/** Write a status change for a run. */
export function writeStatusChange(runId: string, status: LedgerStatus): Promise<void>;

/** Read all ledger entries for a parent key, grouped by runId. */
export function readLedger(parentKey: string): Promise<Map<string, LedgerEntry>>;

/** Reconcile persisted children on session_start. */
export function reconcilePersistedChildren(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  parentKey: string,
): Promise<ReconciliationResult>;

/** Mark a result as collected. */
export function markCollected(parentKey: string, runId: string): Promise<void>;

/** Check if a result was already collected. */
export function isCollected(parentKey: string, runId: string): Promise<boolean>;
```

## 7. Subagent Runner Integration

In `subagent-runner.ts` (from the socket transport spec), add result file
writing:

```typescript
export async function runSubagentTask(
  pi, ctx, metadata, state,
): Promise<void> {
  // ... run agent ...

  // Build result
  const subagentResult: SubagentResult = { ... };

  // Write canonical result file BEFORE emitting event
  await writeResultFile(metadata.runId, subagentResult);

  // Emit event (subscribers can now read the file)
  fireResultReadyEvents(state, subagentResult);

  // Write ledger status change
  await writeStatusChange(metadata.runId, "completed");
}
```

Write-then-emit ordering is critical — ensures the file exists when a
subscriber tries to read it.

## 8. What Ships

### New files

| File                                              | Purpose                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| `pi-subagents/extensions/subagents/ledger.ts`     | Ledger I/O, reconciliation, collected tracking |
| `pi-subagents/extensions/subagents/parent-key.ts` | Persistent parent key management               |

### Changed files

| File                                            | Change                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `pi-toolkit/session-control/subagent-runner.ts` | Write result file before emitting event                   |
| `pi-subagents/socket-harness.ts`                | Write spawn to ledger, handle orphan policy               |
| `pi-subagents/index.ts`                         | Call reconcilePersistedChildren on session_start          |
| `pi-subagents/session-runner.ts`                | Add `orphan` parameter to agent spawn options             |
| `pi-subagents/types.ts`                         | Add `LedgerEntry`, `LedgerSpawnEntry`, orphan policy type |

### New dependency

None. Ledger files live in `~/.pi/agent/pi-subagents/` — same directory the
package already uses for state. No cross-package dependency beyond what
socket transport already introduces.

## 9. Implementation Status

| Module | Status | File |
|---|---|---|
| ledger.ts | ✅ Done | `pi-subagents/extensions/subagents/ledger/ledger.ts` |
| parent-key.ts | ✅ Done | `pi-subagents/extensions/subagents/ledger/parent-key.ts` |
| Result file writing | ✅ Done | `session-control/subagent-runner.ts` (write-then-emit) |
| Reconciliation on session_start | ✅ API ready | `reconcilePersistedChildren()` exported, not yet wired to index.ts hook |
| Orphan policy | ✅ API ready | Parameter on subagent(), not yet wired to spawn flow |

### Tests (compiled, not executed)
- `ledger.test.ts` — 13 tests covering spawn, status changes, read with filtering, collected tracking, reconciliation (crashed, collected, status update)
- `parent-key.test.ts` — 4 tests covering key creation, stability, persistence, sync getter

### Not yet wired
- `reconcilePersistedChildren` needs to be called on `session_start` in pi-subagents index.ts
- `orphan` parameter needs to flow through from subagent() → socket-harness → spawn
- `subagent-runner.ts` calls `writeStatusChange` via dynamic import (non-fatal if not found)
