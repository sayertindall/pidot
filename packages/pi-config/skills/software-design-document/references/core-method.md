# Core Method

Distilled from Michael Lynch, "How to Write an Effective Software Design
Document" (refactoringenglish.com/excerpts/write-an-effective-design-doc/).
This file is type-agnostic. The type references filter and extend it.

## 1. When to write, and how much

Write a design document when any of these is true; two or more makes it
almost certainly worth the effort:

- Multiple people coordinate work to implement the design.
- The work exceeds roughly three months of full-time development.
- The implementation runs in production for years.
- The project crosses team boundaries.
- Goals or requirements are ambiguous.
- A design-time decision could prevent a catastrophic risk (security flaw,
  legal exposure, unrecoverable data loss).

Investment has no universal rule. A one-pager and a fifty-page multi-team
document are both correct instruments for different jobs. Sometimes the right
investment is zero — say so instead of producing ceremony.

## 2. The content filter

Ask of every decision: **what is the penalty for being wrong?**

- High penalty (language choice, storage engine, wire contract, ownership
  boundary, security model): document the decision, the evidence, and the
  alternatives.
- Low penalty (pagination style, button copy, an easily swapped library):
  leave it out. Do not spend review cycles on it.

If the document specifies every detail, it has become the implementation and
has failed as a design document.

## 3. Section catalog

Use the subset that earns its place. The type references say which sections
are required per type.

**Framing**
- *Title.* Short, distinctive, evocative. People will say it aloud.
- *Metadata.* Author and contact, created date, status, authoritative URL or
  path, approvers and sign-off dates.
- *Objective.* One sentence, plain language, first page.
- *Background.* Why this project, what problem, what came before. Must make
  sense with zero outside context.
- *Related documents.* Links to specs, test plans, prior iterations.

**Scope**
- *Goals.* Impact on users, team, or company. Never implementation details.
- *Non-goals.* What readers might assume is in scope but is not.
- *Scenarios.* Named-person narratives of the finished system in use.
- *Glossary.* Only for terms the audience will not know. Prefer inline
  definition; prefer recognizable terms over any glossary.
- *Constraints.* Budget, client, infrastructure, or dependency constraints
  that shape the design.

**Technical**
- *Diagrams.* Data flow, component fit, dependency and client interaction,
  protocols. Editable source (Mermaid, D2, Graphviz) checked in with the doc.
- *Interfaces.* User interface sketches (rough, not pixel-perfect), API and
  CLI semantics, file formats.
- *Dependencies and infrastructure.* Languages, runtimes, hardware, storage.
  Agonize over the hard-to-swap ones; wave through the easy swaps.
- *Service level objectives.* Measurable targets (availability, latency,
  scale) so "performant" is never left to interpretation.
- *Monitoring and alerting.* How each SLO failure is detected, and what pages
  a human.
- *Logging.* Critical events, levels, storage, retention, access, and what
  must never be logged.

**Risk**
- *Security.* Threats considered, attack surface, trust boundaries. Document
  the rationale even when threats seem irrelevant — the rationale is what
  reviewers can attack.
- *Privacy.* Sensitive data handled, retention, access, protection.
- *Legal.* Regulated domains, contractual limits, licensing.

**Process**
- *Timeline.* Milestones that each produce a stakeholder-visible artifact
  (UI on fake data first, plumbing later). Only include dates the user
  supplied or asked for.
- *Open issues.* Per issue: the problem, options seen, proposed resolution,
  immediate next step.
- *Resolved issues.* Decision summary on top, original discussion preserved.
- *Alternatives considered.* A few lines per strong alternative and the
  reason it lost — especially the ones that looked appealing.

## 4. Driving review

The document exists to collect attackable claims. Make review easy:

- Put the controversial decisions early and label them.
- Give each open issue a proposed resolution so reviewers react to something
  concrete instead of brainstorming from zero.
- Keep an approval register when multiple people must sign off: one row per
  decision, one column for the ruling.

## 5. The short form (decision record)

For a single contained decision, write one page:

```markdown
# <Decision title>
- Status: proposed | accepted | superseded
- Date, author

## Context
What forces this decision now. Two or three sentences.

## Decision
What we will do, stated actively.

## Alternatives
One line each: option, why not.

## Consequences
What becomes easier, what becomes harder, what we must revisit later.
```
