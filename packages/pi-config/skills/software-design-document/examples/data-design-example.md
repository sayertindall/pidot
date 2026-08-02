# Example: Data Design Document

An abbreviated but structurally complete example. Note canonical-vs-derived
labeling and the expand-migrate-contract plan with per-step verification and
rollback.

---

# Audit Log Storage: JSONB Rows to Partitioned Tables

**Status:** DRAFT FOR APPROVAL. **Author:** K. Novak (kn@example.com).
**Created:** 2026-07-14. **Location:** docs/design/audit-partition-design.md.

## Objective

Move audit events from one unbounded JSONB table to monthly-partitioned
typed tables, so retention becomes a partition drop and the two dashboard
queries stop timing out.

## Background

`audit_events` holds 480M rows (checked 2026-07-13, `pg_class.reltuples`).
Everything lives in one JSONB `payload` column. The two dashboard queries
filter on `payload->>'actor_id'` and `payload->>'kind'`; both expression
indexes together are 41 GB and the p99 for the actor query is 22 s
(pg_stat_statements, same date). Retention policy says 13 months; deletes
run as batched `DELETE` jobs that regularly get cancelled for bloat reasons,
so real retention is currently "forever".

## Goals

- Actor and kind dashboard queries return in under 1 s at current volume.
- Retention runs as a metadata operation, not a delete job.

## Non-goals

- Changing what is audited or the write API. Producers keep calling
  `audit.log(...)` unchanged.
- Full-text search over payloads. Not a served query today.

## Data model

Canonical: `audit_events_p`, monthly range partitions on `created_at`:

```sql
CREATE TABLE audit_events_p (
  id          uuid        NOT NULL,
  created_at  timestamptz NOT NULL,
  actor_id    uuid        NOT NULL,
  kind        text        NOT NULL,
  payload     jsonb       NOT NULL,   -- residue: fields not promoted
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
```

Promoted columns (`actor_id`, `kind`, `created_at`) are the fields the
served queries filter on; everything else stays in `payload`. Invariant the
schema cannot enforce: `payload` never duplicates a promoted column - the
writer strips them; the enforcement point is `audit/writer.py`.

Derived: the daily `audit_counts` rollup. Rebuild path: full recount from
`audit_events_p`; documented in the runbook, exercised in CI monthly.

Indexes, each with its query: `(actor_id, created_at desc)` per partition
(actor dashboard); `(kind, created_at desc)` (kind dashboard). No other
indexes: no other served queries exist.

## Consistency and lifecycle

Writes are single-row inserts in the producer's transaction, as today.
Audit rows are immutable: no update or delete path exists in code, and
retention is the only destruction. Delete semantics: dropping a partition is
a hard, unrecoverable delete of that month; this is the stated intent of the
13-month policy. Legal hold: pause the drop job, nothing else needed.

## Migration plan (expand - migrate - contract)

| Step | Action | Verify | Rollback |
|---|---|---|---|
| 1 Expand | Create `audit_events_p` + partitions for 14 months | Table exists; writer untouched | Drop new table |
| 2 Dual-write | Writer inserts into both tables in one transaction | Row counts match for a 1 h window (`count(*)` both sides) | Feature-flag off dual-write |
| 3 Backfill | Copy old rows month-by-month, oldest first, batched | Per-month checksum: count + min/max id both sides | Stop job; already-copied months are inert |
| 4 Cut reads | Dashboards read the new table behind a flag | p99 under 1 s for one week; results diff empty on sampled queries | Flip flag back |
| 5 Contract | Stop dual-write; rename old table `_retired`; drop after 30 days | No reader references old table (pg_stat_statements scan) | Rename back within 30 days |

Old code against new data during the window: none - readers are flagged,
and the writer change ships before any reader change. Writes made during
any rollback are safe because the old table receives every write until
step 5.

## Scenario

An auditor asks for every action by one contractor in March. The dashboard
hits `(actor_id, created_at)` on two partitions and returns in 300 ms. On
the first of the month, the retention job creates next month's partition and
drops month -14; the drop takes milliseconds and no vacuum debt.

## Security and privacy

Payloads contain user identifiers, no secrets by policy; the writer already
redacts token-shaped strings (`audit/writer.py:71`, kept). Access unchanged:
the `audit_read` role. Backups inherit the encryption posture of the
cluster; partition drops propagate to backups per the 35-day backup window,
which slightly outlives the 13-month policy and is accepted.

## Open issues

- **Partition granularity.** Monthly chosen for 13-month retention symmetry.
  Weekly would shrink hot-partition size but multiplies partition count 4x.
  Proposal: monthly; revisit only if a single month exceeds 80M rows.
  Next step: none; decide at approval.

## Alternatives considered

- **Keep JSONB, add more expression indexes.** Rejected: indexes already
  41 GB; retention still delete-shaped.
- **Move audit to ClickHouse.** Rejected for now: new stateful system for
  two queries that partitioning serves; revisit if analytical queries
  multiply.
