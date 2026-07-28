## TillDone v2 — Spec

---

### 1. Core Principle

**In-memory state, lazy persist.** The task list lives in memory for the life of the session. Disk is only touched twice: once on session start (restore), once on session end (persist). Zero disk I/O during normal operation.

---

### 2. State Model

```typescript
type TaskStatus = "idle" | "inprogress" | "done";

interface Task {
  id: number;
  text: string;
  status: TaskStatus;
  gate?: string;
}

interface TillDoneState {
  enabled: boolean;
  tasks: Task[];
  nextId: number;
  // v2 additions:
  version: 2;
  sessionId: string;
  lastModified: number; // unix ms
}
```

State is held in a module-level `Map<sessionId, TillDoneState>`. No file reads mid-session. No mutation queue. No atomic writes. No corruption recovery needed — if the in-memory state is corrupt, something is deeply wrong and the process is crashing anyway.

---

### 3. Storage

**Restore** (session start):

- Read `~/.pi/agent/tilldone/<sessionId>.json` if it exists.
- Validate schema. If corrupt or missing, use default state.
- Load into memory. Close the file handle. Done.

**Persist** (session end):

- Write to `~/.pi/agent/tilldone/<sessionId>.json`.
- Atomic write (temp + rename) for crash safety.
- That's the only write. Ever.

**Cleanup**:

- On session end, optionally drop from the in-memory map after persist.
- Stale session files older than N days (default 30) get cleaned on pi startup.

No per-call writes. No mutation queue. The filesystem is not a database.

---

### 4. Tool API

Same actions (`add`, `done`, `next`, `prev`, `list`, `clear`, `update`). Implementation changes:

| Action   | Disk I/O | Behavior                                              |
| -------- | -------- | ----------------------------------------------------- |
| `add`    | none     | Push to in-memory array, bump nextId                  |
| `done`   | none     | Run gate if present (shell out), then set status=done |
| `next`   | none     | Current → done, next idle → inprogress                |
| `prev`   | none     | Current → idle, previous → inprogress                 |
| `list`   | none     | Return in-memory state. **Does not mutate anything.** |
| `clear`  | none     | Reset tasks to `[]`, nextId to 1                      |
| `update` | none     | Mutate task in place                                  |

`list` no longer goes through a mutation path. It reads the value directly and returns it. It is not a write.

---

### 5. Hooks

**`session_start`**:

- Restore state from disk (if any).
- Update widget.

**`session_end`** (new hook, or use existing shutdown signal):

- Persist state to disk.
- Drop from in-memory map.

**`before_agent_start`**:

- Read in-memory state. If enabled, inject task context into system message.
- If blocking gate exists (tasks present but none inprogress), inject block message.
- **No disk I/O.**

**`agent_end`**:

- Read in-memory state. If incomplete tasks remain, send nudge.
- **No disk I/O.**

---

### 6. Gate System

Unchanged in behavior. Gates are shell commands that must exit 0 before a task can be marked done. The gate runs at `done` time only. Implementation detail: use `child_process.exec` with a timeout (default 30s). Signal forwarding via `AbortSignal` as before.

**v2 addition**: gates can optionally be `{ cmd: string, timeout: number }` objects instead of just strings.

---

### 7. Widget

Unchanged in behavior. Status line shows `TASKS: done/total`. Below-editor widget shows current in-progress task. Updates are triggered explicitly after each tool call and on session restore — not on every read.

**v2 addition**: widget can show the next N (default 3) upcoming idle tasks below the current one, dimmed. Gives the model and user more situational awareness.

---

### 8. Architecture

```
┌─────────────────────────────────────────────┐
│  tilldone state (Map<sessionId, State>)     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ sess A  │  │ sess B  │  │ sess C  │     │
│  └─────────┘  └─────────┘  └─────────┘     │
│       ↑ ↓         ↑ ↓         ↑ ↓          │
│  tool calls   tool calls   tool calls       │
│  (mutate)     (mutate)     (mutate)         │
│       │           │           │             │
│       ▼           ▼           ▼             │
│  session_end  session_end  session_end      │
│  (persist)    (persist)    (persist)        │
└─────────────────────────────────────────────┘
```

One file, two touchpoints: restore and persist. Everything in between is a plain object mutation.

---

### 9. Migration from v1

On session start:

1. Check for v1 state file at `~/.pi/agent/pi-toolkit/tilldone/<sessionId>/state.json`.
2. If it exists and no v2 file exists at the new path, read it, convert to v2 shape, write to v2 path.
3. Delete v1 file.
4. v1 session directories that are empty after migration get cleaned up.

---

### 10. What Goes Away

- `mutateState` — replaced by direct object mutation + explicit persist on session end.
- Mutation queue (`queues` Map) — no concurrent writers, no locks needed.
- `writeStateAtomic` called on every tool invocation — only called once on session end.
- `moveCorrupt` — if the file is corrupt on restore, default state. No multi-file corruption handling needed.
- `readStateOrEmpty` on every call — read once on start, cache in memory.
- `statePath`, `getStateDir` — simplified to a single path function.
- Identity transforms that write unchanged state to disk.

---

### 11. File Layout

```
~/.pi/agent/tilldone/
  <session-uuid>.json    # one file per session
```

No subdirectories per session. One flat directory. The session ID is already a UUID — it's unique. No need for a folder per session containing a single file.

---

### 12. Error Handling

- **Corrupt state file on restore**: discard, use default state, log warning.
- **Disk full on persist**: log error, don't crash. State is lost for that session but the agent continues.
- **Gate timeout**: kill child process, return failure. Timeout is configurable, default 30s.
- **Gate command not found**: return failure with clear stderr.

No other error paths. The rest is plain object manipulation — it cannot fail.
