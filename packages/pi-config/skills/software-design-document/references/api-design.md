# API Design Document

For endpoints, wire contracts, webhooks, SDK surfaces, and protocol
decisions. The costliest mistakes here are compatibility mistakes: a shipped
contract is a promise, and breaking it transfers your cost onto every
consumer.

## Audience

Consumers of the API first, implementers second. Write so an external
integrator could build against the document alone.

## Required sections

1. Metadata, objective, background (who consumes this and why now).
2. Goals and non-goals. Non-goals name the use cases the API deliberately
   does not serve.
3. **Resource and operation model.** The nouns, their identity rules, and the
   operations, before any endpoint syntax. Identity decisions (who mints ids,
   what is unique, what is immutable) are the most permanent choices in the
   document.
4. **Contract tables.** Per operation: method and path (or RPC name),
   request shape, response shape, and every error with its shape. Errors are
   part of the contract; a typed error a client can branch on is design, a
   string is not.
5. **Semantics that bite.** Idempotency (which operations, keyed how),
   pagination, ordering guarantees, concurrency control (revisions, ETags),
   partial failure, and timeout behavior. Every mutation needs an answer to
   "what happens when the caller retries".
6. **Versioning and evolution.** How additive change ships, what counts as
   breaking, deprecation policy, and how a client detects capability.
7. **AuthN/AuthZ.** Who can call what, how identity travels, what a 404
   versus 403 discloses about existence.
8. Scenarios: one full consumer integration told end to end, including an
   error recovery.
9. Rate limits, SLOs, and observability for consumers (request ids,
   error codes stable enough to alert on).
10. Open issues, resolved issues, alternatives (include the transport or
    protocol you rejected).

## Optional sections

Webhooks/eventing (delivery guarantees, retries, signature verification),
SDK considerations, migration from a prior API version, full schema files
(link them; the document carries shapes and semantics).

## Level of detail

- Shapes by example plus field table; link the authoritative schema rather
  than duplicating it.
- Every field: type, required or optional, and whether clients must tolerate
  its absence or new siblings (tolerant-reader posture stated explicitly).

## Type-specific pitfalls

- Designing the happy-path contract and leaving errors to the implementation.
- Server-minted request ids, which silently destroy client retry idempotency.
- Unstated ordering or consistency guarantees that clients infer from
  observed behavior and then depend on.
- Breaking change hidden as "just adding a required field".
- 404/403 semantics leaking resource existence to non-owners.

## Checklist

- Could an integrator build a client from this document without reading the
  server code?
- Does every mutation define its retry story?
- Does every operation list its errors as typed, branchable shapes?
- Is the breaking-change line drawn precisely enough to settle a future
  argument?
- Do the scenarios include recovery from at least one failure?
