# Data Design Document

For schemas, storage engine choices, migrations, retention, and consistency
models. The costliest mistakes here are the most permanent in software:
data outlives code, and a bad shape or a lossy migration is forever.

## Audience

Engineers who will write against the schema, and operators who will run the
migration. The migration plan is read at 2 a.m.; write it for that reader.

## Required sections

1. Metadata, objective, background (what the data is, who reads and writes
   it, current volumes if known — otherwise say unknown, do not invent).
2. Goals and non-goals.
3. **Data model.** Entities, relationships, identity, and invariants. State
   the invariants the schema itself cannot enforce; they are the ones that
   rot. Distinguish canonical state from derived state, and name the rebuild
   path for everything derived.
4. **Storage decisions.** Engine, partitioning, indexing tied to the actual
   query patterns listed in the background. An index without a named query is
   a guess.
5. **Consistency and concurrency.** Transaction boundaries, what may be
   stale, optimistic versus pessimistic control, and conflict behavior.
6. **Lifecycle.** Creation, mutation rules, soft versus hard delete,
   retention, archival, and purge. "Deleted" must be defined: recoverable or
   gone, and who can tell the difference.
7. **Migration plan** (when changing existing data). Per step: forward
   change, verification query, rollback story, and behavior of old code
   against new data during the rollout window. Expand-migrate-contract is the
   default shape; a one-way door needs a stated reason.
8. Scenarios: the top read and write paths traced through the model.
9. Security and privacy: access boundaries, sensitive fields, encryption
   posture, what never appears in logs or backups unencrypted.
10. Open issues, resolved issues, alternatives (include the engine or shape
    you rejected).

## Optional sections

Capacity and growth (only with real numbers), backup and restore
(include when the data is canonical), observability (migration progress,
drift detection), multi-tenancy rules.

## Level of detail

- DDL or schema definitions for the core tables/collections; prose for the
  rest.
- Every migration step is executable and verifiable as written, or it is a
  sketch and labeled as one.

## Type-specific pitfalls

- Designing the schema for the current UI instead of the domain; UIs churn
  faster than data.
- Derived state with no rebuild path, which silently becomes canonical.
- Migration plans without a rollback, or with a rollback that loses writes
  made during the window.
- Retention decided by default (forever) rather than on purpose.
- Nullable columns whose null means three different things.

## Checklist

- Is canonical versus derived explicit for every stored fact?
- Does every index cite the query it serves?
- Can the migration roll back at every step without losing committed writes?
- Is delete defined precisely (soft, hard, recoverable by whom, until when)?
- Do the invariants the schema cannot enforce have a named enforcement point?
