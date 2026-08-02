---
name: software-design-document
description: "Generate a production-quality software design document adapted to what is being designed — system architecture, a feature change, UI/UX behavior, an API contract, a data model, or an early concept. Use this whenever the user asks for a design doc, spec, RFC, architecture document, technical proposal, UI state spec, API design, migration plan, or says 'write up the design', 'document this design', 'propose how we should build X' — even if they don't say 'design document'. Also use it when an audit or investigation must end in a written design deliverable."
version: 0.1.0
---

# Software Design Document

Write design documents that force the hard decisions before implementation and
give reviewers something concrete to attack. The method comes from Michael
Lynch's "How to Write an Effective Software Design Document"
(refactoringenglish.com); this skill adapts it per document type.

A design doc is not an implementation task list and not a requirements dump.
It records the decisions that are expensive to reverse, the evidence behind
them, and the questions still open. If a decision can be changed in an
afternoon, it does not belong in the document.

## Workflow

1. **Gather evidence.** Read the code, specs, tickets, and prior documents the
   request touches. Every claim about current behavior must carry a source
   (file and line, route, document section). If you cannot verify a claim,
   label it as an assumption. Never design against an imagined codebase when a
   real one is available.
2. **Classify the document type.** Use the table below. When the request
   spans types, pick the primary type (the one whose mistakes cost most) and
   borrow sections from the secondary type.
3. **Calibrate investment.** Read `references/core-method.md` section 1. A
   one-page doc is correct for a small reversible change; a full document is
   correct when people coordinate, the work runs for months, or a wrong
   design-time choice is catastrophic. Say which calibration you chose if the
   user did not.
4. **Load the writing standard.** Read
   `/Users/sayertindall/Dev/Tools/pi-extensions/packages/pi-config/skills/simple-technical-english/SKILL.md`
   and apply its rules to the document prose. This is not optional; see
   "Writing standard" below.
5. **Read the type reference.** Each type has a reference file with required
   sections, level of detail, pitfalls, and a checklist, plus a worked
   example. Read both before drafting.
6. **Draft.** Follow the section catalog in `references/core-method.md`
   section 3, filtered by the type reference. Include only sections that earn
   their place.
7. **Self-review.** Run the checklist at the end of the type reference and the
   universal checklist below. Fix what fails before delivering.

## Classification

| Signals in the request | Type | Reference | Example |
|---|---|---|---|
| New service, multi-component architecture, infrastructure choices, scaling, "how should the whole thing work" | System design | `references/system-design.md` | `examples/system-design-example.md` |
| A change inside an existing system: new capability, refactor, subsystem overhaul, "add X to Y" | Feature design | `references/feature-design.md` | `examples/feature-design-example.md` |
| Screens, panels, navigation, interaction states, state ownership in a client, "what the user sees and does" | UI/UX design | `references/ui-ux-design.md` | `examples/ui-ux-design-example.md` |
| Endpoints, request/response shapes, versioning, webhooks, SDK surface, wire contracts | API design | `references/api-design.md` | `examples/api-design-example.md` |
| Schemas, storage engines, migrations, retention, consistency, "where does the data live" | Data design | `references/data-design.md` | `examples/data-design-example.md` |
| Early idea, problem framing, no committed implementation, "should we build this at all", vision | Conceptual design | `references/conceptual-design.md` | `examples/conceptual-design-example.md` |

Hybrids are normal. A UI overhaul that needs new endpoints is a UI/UX doc
that imports the API reference's contract-table section. A migration is a
data doc that imports the feature reference's rollout section. Name the
primary type in the document metadata so readers know how to judge it.

If the decision is genuinely small — one library choice, one narrow tradeoff —
do not inflate it into a full document. Write a one-page decision record:
context, decision, alternatives, consequences. `references/core-method.md`
section 5 gives the short form.

## Universal rules (all types)

- **The filter is the penalty for being wrong.** For every candidate section
  or decision, ask what it costs if the choice is wrong. Permanent choices get
  detail and alternatives. Reversible choices get a sentence or nothing.
- **Goals state impact, not implementation.** "Reduce deploy-related outages"
  is a goal. "Adopt Kubernetes" is not.
- **Non-goals are explicit.** List what a reasonable reader would assume is in
  scope but is not, and say why.
- **The background stands alone.** A reader with no prior context must
  understand the problem from page one. If the document only makes sense after
  a hallway explanation, the background has failed.
- **Scenarios make it concrete.** At least one narrative of a named person
  using the finished thing, step by step.
- **Diagrams are editable.** Use Mermaid (or another text-based format) inline
  so the diagram source lives with the document. Never reference a diagram
  that has no source.
- **Open issues are honest.** Unresolved problems get an Open Issues entry:
  the problem, the options, the proposed resolution, the next step. Resolved
  ones move to Resolved Issues with the decision kept for posterity.
- **Alternatives are brief.** A few lines per strong alternative and why it
  lost. Do not catalog every rejected thought.
- **No invented facts.** Metrics, SLOs, and timelines appear only when the
  user supplied them or the evidence supports them. Otherwise write the
  placeholder as an open issue, not a plausible-looking number.

## Writing standard

Always apply the Simplified Technical English skill at
`/Users/sayertindall/Dev/Tools/pi-extensions/packages/pi-config/skills/simple-technical-english`
when producing the document. Read its SKILL.md and follow its core rules in
the document body: one word for one idea, active voice, simple tenses, one
instruction per sentence, sentence length limits, no noun stacks, lists for
sequences. Where STE brevity would drop necessary precision (a safety
condition, a scope qualifier, an exact number), keep the longer phrasing —
the STE skill itself requires this. Document titles and section names may
stay conventional; the discipline applies to the prose.

## Output conventions

- Deliver one Markdown file. If the user names a path, use it; otherwise
  propose a descriptive kebab-or-caps name consistent with the repository's
  existing docs, or default to `docs/design/<topic>-design.md`.
- Open with metadata: status (default `DRAFT FOR APPROVAL`), author, date,
  authoritative location, approvers if known.
- One-sentence objective before anything else.
- If the document proposes work in phases, every phase gets a verification
  gate: how a reviewer confirms the phase is done and correct.

## Universal self-review checklist

- Does the first page answer: what is this, why now, what changes?
- Is every load-bearing claim sourced or labeled as an assumption?
- Could a reviewer disagree with something specific? A document nobody can
  disagree with has no decisions in it.
- Are all sections pulling weight? Delete any that restate another.
- Did the STE pass run over the final prose?
- Are open questions listed instead of silently resolved by optimism?
