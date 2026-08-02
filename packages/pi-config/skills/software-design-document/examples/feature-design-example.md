# Example: Feature Design Document

An abbreviated but structurally complete example. Note the sourced
current-state audit and the phased, revertable rollout.

---

# Scheduled Report Export

**Status:** DRAFT FOR APPROVAL. **Author:** R. Chen (rc@example.com).
**Created:** 2026-06-02. **Location:** docs/design/scheduled-export-design.md.

## Objective

Let a user schedule a recurring CSV export of any saved report, delivered to
email, so analysts stop exporting the same report by hand every Monday.

## Background

Support tagged 31 tickets this quarter asking for recurring exports. Today a
user opens a report and clicks Export; `reports/export.py:88` builds the CSV
synchronously in the request handler and streams it back. There is no job
system for reports. There is a general worker queue (`core/jobs.py`) used by
billing, with retry and dead-letter support.

## Current-state audit

- Export is synchronous and times out on reports over ~200k rows
  (`reports/export.py:101` sets a 30 s limit). Verified by replaying ticket
  #4812's report: 41 s, HTTP 504.
- Saved reports store their query definition in `report_defs` with a
  `revision` column (`db/models.py:342`). Nothing mutates a definition
  without bumping it.
- Email delivery exists behind `core/mail.py:send` with per-message
  idempotency keys.

## Goals

- A user schedules an export in under a minute and stops thinking about it.
- Delivery succeeds for reports that time out interactively today.

## Non-goals

- New export formats (XLSX, JSON). CSV only; format work is its own change.
- Delivery targets other than email (S3, webhooks). The schedule model
  leaves room; the targets do not ship here.
- Fixing the interactive-export timeout. This feature routes around it; the
  fix is ticket #4901.

## Design

A new `report_schedules` table: `(id, report_id, report_revision, cron_expr,
recipient, enabled, last_run_at)`. A scheduler tick (existing worker queue,
new job kind `report_export`) enqueues due schedules. The export job reuses
the CSV builder but runs it in the worker with no request timeout, then
delivers through `core/mail.py` keyed by `(schedule_id, window_start)`, so a
retried job cannot email twice for one window.

The schedule pins `report_revision`. If the underlying report definition
changes, the schedule keeps exporting the pinned revision and surfaces a
"definition changed" flag in the UI; the user re-pins deliberately. This
avoids silently changing a report someone's finance process depends on.

Deleted: nothing. Changed ownership: none. The synchronous path stays for
interactive export.

## Compatibility and migration

New table only; no existing rows change. First run of new code creates the
table by migration. Downgrade: the table is ignored by old code; schedules
pause rather than break. In-flight export jobs at downgrade die in the
dead-letter queue and are safe to replay.

## Scenario

Ana opens "Weekly churn" and picks Schedule, Mondays 07:00, to herself. On
Monday the worker builds the CSV in 48 s and emails it. The following week a
teammate edits the report definition. Ana's Monday email still matches the
version she scheduled, and the schedule row shows "definition changed" until
she re-pins.

## Rollout

| Phase | Contents | Verification gate |
|---|---|---|
| A | Table + job kind + builder-in-worker, no UI | Job test suite green; a hand-inserted schedule delivers; replay does not double-send |
| B | Schedule UI + changed-definition flag | E2E test schedules and receives; downgrade test shows pause-not-break |
| C | Enable for all tenants | Dead-letter rate under 0.5% for one week on pilot tenants |

Each phase merges alone and reverts alone; phase A is invisible to users.

## Open issues

- **Timezone for cron.** Options: tenant timezone or UTC-only with UI hint.
  Proposal: tenant timezone, since 07:00 means local morning to every
  requester in the tickets. Next step: confirm tenant tz field is reliable.

## Alternatives considered

- **Fix interactive export instead.** Rejected: async delivery is wanted even
  where the timeout is not hit (the Monday-morning workflow), per tickets.
- **Pin nothing and always export latest.** Rejected: silent definition
  drift into finance workflows; the pin plus flag is one column of cost.
