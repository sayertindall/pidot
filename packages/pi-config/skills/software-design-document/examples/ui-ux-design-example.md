# Example: UI/UX Design Document

An abbreviated but structurally complete example. Note the state-ownership
table, the full state matrix per surface, and honest copy rules.

---

# Draft Recovery and the Compose Panel

**Status:** DRAFT FOR APPROVAL. **Author:** T. Iyer (ti@example.com).
**Created:** 2026-04-20. **Location:** docs/design/compose-drafts-design.md.

## Objective

Make the compose panel never lose user text: drafts survive navigation,
crash, and offline periods, and the user can always tell whether their text
is safe.

## Background

The compose panel keeps its text in component state only
(`web/src/compose/Panel.tsx:57`). Navigation unmounts the panel and the text
dies. Crash reports show 120 sessions last month ended with a non-empty
compose buffer. There is no offline indicator in the panel; users learn a
send failed only from a toast that disappears in 4 s.

## Goals

- Typed text survives navigation, reload, crash, and going offline.
- The user can see, at any moment, whether their text is stored.
- Send failures are recoverable in place, not from a vanished toast.

## Non-goals

- Multi-device draft sync. Drafts are device-local; server sync is a
  separate proposal with different privacy questions.
- Rich-text formatting changes. The editor widget is untouched.

## State ownership

| Fact | Owner | Durability |
|---|---|---|
| Sent messages | Server | Durable truth |
| Unsent draft text, per conversation | Compose store (new) | Persisted local: IndexedDB `drafts` |
| Send-in-flight status | Compose store | Session memory |
| Panel open/closed, cursor position | Panel component | Transient view state |

One owner per fact. The panel component never persists anything itself; it
reads and writes the compose store. The server never sees a draft.

## Surface behavior: compose panel

| State | Trigger | Render |
|---|---|---|
| Ready | Draft loaded or empty | Editor enabled; save indicator idle |
| Saving | Text changed, debounce 500 ms | Indicator "Saving..." |
| Saved | Write confirmed | Indicator "Saved" fading after 1 s |
| Save failed | IndexedDB write error | Persistent banner: "Drafts are not being saved on this device"; editor stays enabled |
| Sending | Send pressed | Editor locked; Stop available |
| Send failed | Network or server error | Text restored to editor, unlocked; inline error with Retry; draft still stored |
| Offline | Connectivity lost | Send disabled with byline "Offline - draft saved on this device"; editing works |

Empty, loading, and failed are visually distinct: an empty editor shows the
placeholder, a loading draft shows a skeleton line, a failed draft load shows
"Could not load your draft" with Retry. These three must never look alike.

## Flows

Keyboard: Cmd-Enter sends; Escape closes the panel (draft persists, no
prompt - closing is safe by design, so no confirmation is honest); Cmd-Z is
the editor's own undo.

Recovery flow: after a crash, reopening a conversation loads its draft from
IndexedDB before first paint of the panel. No "restore draft?" dialog: the
text simply is where the user left it. A dialog would imply the text was in
danger.

## Failure and offline behavior

All editing and draft persistence work offline. Send is the only disabled
action, disabled with its reason visible. Conflict is impossible by
construction: drafts are device-local and single-writer.

## Copy rules

- Never "Draft saved to cloud" - drafts are local; say "on this device".
- The send-failed error names the cause class ("No connection", "Server
  rejected the message") and never blames the user.
- No control renders enabled unless its handler is wired and reachable.

## Persistence and migration

IndexedDB database `compose`, store `drafts`, key = conversation id, value =
`{text, updated_at, version: 1}`. First run finds no store and creates it;
nothing migrates because nothing was persisted before. Corrupt store: drop
and recreate, show the save-failed banner once.

## Open issues

- **Draft retention.** Options: keep forever, or expire after 90 days.
  Proposal: keep forever until the storage-pressure work lands; expiry
  deletes user words on a timer, which needs a stronger reason than tidiness.
  Next step: product sign-off.

## Alternatives considered

- **localStorage instead of IndexedDB.** Rejected: synchronous writes on the
  typing path and a ~5 MB ceiling shared with other features.
- **Server-side drafts.** Rejected here: turns a text box into a privacy and
  sync design; see non-goals.
