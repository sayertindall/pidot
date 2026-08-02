# System Design Document

For new services, multi-component architectures, infrastructure choices, and
whole-system behavior. The costliest mistakes here are boundary mistakes:
which component owns which truth, and what crosses the wire between them.

## Audience

Engineers who will build it, adjacent teams who will integrate with it, and
reviewers who must find the flaw before production does. Write the background
for the integrator who has never seen the codebase.

## Required sections

1. Metadata, objective, background, related documents.
2. Goals and non-goals.
3. **Architecture overview.** One diagram of components and data flow, plus a
   one-paragraph "the system in one paragraph" statement. If you cannot write
   that paragraph, the design is not settled.
4. **Component responsibilities.** Per component: what it owns, what it must
   never do, what it depends on. Ownership of durable truth must be
   unambiguous — two owners of one fact is the classic system-design defect.
5. **Interfaces between components.** Protocols, contracts, and the failure
   semantics of each edge (timeout, retry, idempotency).
6. Dependencies and infrastructure, filtered by the hard-to-swap test.
7. SLOs, monitoring, logging.
8. Security: trust boundaries and attack surface, drawn on the same component
   diagram where possible.
9. Scenarios: at least one happy path and one failure path traced end to end
   through the components.
10. Open issues, resolved issues, alternatives.

## Optional sections

Timeline (include when people coordinate), privacy and legal (include when
user data or regulation is present), capacity estimates (include when scale
is a stated goal — otherwise they are invented numbers).

## Level of detail

- Name every component and every edge. Do not name individual functions.
- Specify wire contracts by shape and semantics, not by full schema — link
  the schema instead.
- State consistency expectations explicitly: what is durable, what is cached,
  what may be stale, and who reconciles.

## Type-specific pitfalls

- A "layers" diagram that is really a deployment diagram. Show data flow, not
  box stacking.
- Failure behavior defined only for the happy path. Every edge needs an
  answer for: down, slow, and lying (stale or duplicate data).
- Implicit second sources of truth (a cache that becomes authoritative, a
  client that "remembers" server state). Name the single owner of every fact.
- SLOs missing until an outage defines them for you.

## Checklist

- Can a new engineer redraw the architecture diagram from the prose alone?
- Does every fact in the system have exactly one named owner?
- Does every inter-component edge define timeout, retry, and idempotency?
- Is there a traced failure scenario, not just a listed one?
- Would the alternatives section convince a skeptic you considered the
  obvious other shape?
