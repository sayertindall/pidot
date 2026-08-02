# Example: Conceptual Design Document

An abbreviated but structurally complete example. Note evidence-backed
problem claims, a quotable core insight, falsifiable assumptions, and a
path to conviction instead of a build plan.

---

# Fieldnotes - Offline-First Inspection Reports

**Status:** CONCEPT FOR DISCUSSION. **Author:** L. Habte (lh@example.com).
**Created:** 2026-02-18. **Location:** docs/design/fieldnotes-concept.md.

## Objective

Explore whether we should build an offline-first mobile reporting tool for
site inspectors, replacing the paper-plus-evening-data-entry workflow.

## Problem, with evidence

- Inspectors work in basements and rural sites without signal. Observed:
  ride-alongs with 4 inspectors across 11 sites; 7 of 11 sites had no usable
  connectivity (trip notes, 2026-01).
- Reports are written twice: paper on site, retyped at home. Measured: the
  four inspectors averaged 68 minutes of evening retyping per day
  (self-logged for two weeks).
- Retyping loses detail. Verified: 14 of 40 sampled reports were missing at
  least one field that existed in the paper notes.
- The current web app is unusable offline by design: every screen fetches
  before render (webapp router, verified in code review 2026-02-03).

Interpretation (labeled as such): the double-entry is not a training issue;
it is the only workflow the connectivity reality permits.

## The concept

A mobile app where the report is authored once, on site, offline, and syncs
itself later. The core insight: **the report, not the connection, is the
unit of work - if a report is complete and valid entirely on the device,
connectivity becomes a background detail instead of a prerequisite.**

What it is not: not a general forms platform, not a dispatch or scheduling
tool, not a replacement for the review workflow reviewers run at desks.

## Scenarios

Sam inspects a basement boiler room, no signal. He fills the report between
measurements: photos attach instantly, validation runs locally, and he signs
it on the device. Driving out, the phone finds LTE and syncs. Sam's evening
retyping does not exist. His reviewer sees the report 40 minutes after the
inspection instead of tomorrow.

Rosa, the reviewer, requests a correction. Sam is back underground; the
request waits on his device until it can land, and conflicts cannot arise
because a report has exactly one author until submission.

## Goals

- Site time is the only authoring time; evening retyping goes to zero.
- A report is reviewable the same day for most inspections.

## Non-goals

- Real-time collaboration on one report. Single-author-until-submission is a
  simplifying principle, not a v1 shortcut.
- Web authoring parity. The desk web app stays for review and admin.

## Principles any implementation must honor

1. Every authoring action works with the radio off.
2. The device holds the only copy until sync confirms; therefore local
   storage is treated as production data (durable, recoverable).
3. Sync is invisible when it works and inspectable when it does not.
4. One author per report until submission; conflict resolution is designed
   out, not handled.

## What we do not know

| Assumption | If wrong | Cheapest falsification |
|---|---|---|
| Inspectors will author on a phone screen | Concept collapses | Paper-prototype week with 3 inspectors on real sites |
| Photo volume fits device storage for a week offline | Sync design gets harder, not fatal | Pull photo counts/sizes from 100 recent reports |
| Single-author rule matches reality | Sync model must handle merges after all | Ask: how often do two people edit one report today? (survey + report audit) |
| Same-day review matters to reviewers | Half the value claim drops | Interview the 3 review leads |

Ranked: the first assumption carries the concept; test it first.

## Alternatives and prior art

- **Do nothing.** Costs about 1.1 hours/inspector/day (measured above) and
  the detail-loss error rate; at 40 inspectors that is roughly 5.5 FTE-hours
  daily.
- **Make the web app a PWA with caching.** Prior attempt in 2024 stalled:
  the fetch-before-render architecture fights offline at every screen.
  Possible, but it retrofits principle 1 onto code built on its opposite.
- **Commercial field-service tools.** Two evaluated in 2025; both require
  connectivity for form logic. Re-verify before committing, vendors move.

## Path to conviction

1. Paper-prototype week (assumption 1). Proves authoring on site is
   acceptable. Cost: one designer-week plus ride-alongs.
2. Storage audit (assumption 2). Cost: one engineer-day.
3. Throwaway spike: one report type, fully offline, ugly, on one inspector's
   phone for a week. Proves principles 1-3 end to end. Cost: two
   engineer-weeks, code is disposable by declaration.
4. Decision review with this document updated by the results.

No further design until step 4 says so.
