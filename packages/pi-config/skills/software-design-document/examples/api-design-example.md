# Example: API Design Document

An abbreviated but structurally complete example. Note the contract tables,
typed errors, and the retry story on every mutation.

---

# Webhooks API v1

**Status:** DRAFT FOR APPROVAL. **Author:** M. Duarte (md@example.com).
**Created:** 2026-03-09. **Location:** docs/design/webhooks-v1-design.md.

## Objective

Let an integrator receive order events by HTTPS callback, with delivery they
can trust and verify, so partners stop polling `/orders` every minute.

## Background

Partners poll today; the top three partners generate 60% of read traffic and
still see events up to 5 minutes late. Two partners asked for callbacks in
Q1 contracts. No eventing surface exists in the public API.

## Goals

- A partner integrates callbacks in under a day using this document alone.
- A partner can verify every delivery is authentic and process it exactly
  once on their side.

## Non-goals

- Event kinds beyond orders (inventory, refunds ship later; the envelope
  leaves room).
- Delivery to queues (SQS, Pub/Sub). HTTPS endpoints only in v1.

## Resource model

- **Subscription**: partner-owned, immutable endpoint URL + event kinds +
  secret. Identity: server-minted `sub_...` id. Changing a URL is create +
  delete, so history stays truthful.
- **Delivery**: one attempt-set to send one event to one subscription.
  Identity: server-minted `dlv_...` id, exposed for support and replay.

## Contracts

| Operation | Method and path | Request | Success | Errors |
|---|---|---|---|---|
| Create subscription | `POST /v1/webhook_subscriptions` | `{url, kinds[], idempotency_key}` | 201 `{id, secret, ...}` | 422 `invalid_url`, 409 `duplicate_key` |
| Delete subscription | `DELETE /v1/webhook_subscriptions/{id}` | - | 204 | 404 `not_found` |
| List deliveries | `GET /v1/webhook_subscriptions/{id}/deliveries?cursor=` | - | 200 page | 404 `not_found` |
| Replay delivery | `POST /v1/deliveries/{id}/replay` | `{idempotency_key}` | 202 `{id}` | 409 `already_pending`, 404 |

All errors share one shape: `{code, message, details?}`. `code` is stable
and branchable; `message` is human text and may change.

## Semantics that bite

- **Idempotency.** Every mutation takes a caller-minted `idempotency_key`.
  Replaying a key returns the original result with `Idempotent-Replayed:
  true`. Keys expire after 24 h.
- **Delivery guarantee.** At-least-once. Consumers dedupe on `event.id`,
  which is stable across redeliveries. The document says this plainly so
  nobody builds on exactly-once.
- **Ordering.** None guaranteed across events. Per-order events carry
  `sequence` so consumers can reorder; the doc promises nothing else.
- **Retries (our side).** Non-2xx or >10 s response: backoff at 1 m, 5 m,
  30 m, 2 h, 8 h, then the subscription is `suspended` and a notification
  email goes out. 410 from the endpoint suspends immediately.
- **Pagination.** Opaque `cursor`, `limit` max 100, newest first.

## Delivery format and verification

POST with headers `Webhook-Id`, `Webhook-Timestamp`, `Webhook-Signature`
(HMAC-SHA256 of `id.timestamp.body` with the subscription secret). Reject
timestamps older than 5 minutes to stop replays. Body:

```json
{ "id": "evt_9f2c", "kind": "order.shipped", "created_at": "...",
  "data": { "order_id": "ord_1128", "sequence": 4 } }
```

Consumers must tolerate unknown fields and unknown kinds (log and 2xx, do
not error): additive change is non-breaking by contract.

## Versioning

Additive fields and new kinds: non-breaking, no notice. Removing a field,
changing a type, or changing signature scheme: breaking, ships as `/v2`,
v1 supported 12 months after v2 announcement. Capability detection: `GET
/v1/webhook_kinds` lists kinds this tenant can subscribe to.

## AuthN/AuthZ

API-key auth as elsewhere in the public API. A subscription belongs to one
tenant; cross-tenant access returns 404, not 403, so existence never leaks.

## Scenario

Priya integrates: creates a subscription with her endpoint, stores the
secret, deploys a handler that verifies the signature, dedupes on
`event.id`, and 2xxes fast (work queued internally). Her endpoint is down
for 40 minutes; deliveries retry and arrive on the 30 m attempt, out of
order; her `sequence` check reorders the two shipped events. A month later
she replays a lost delivery from the dashboard using `dlv_...` from the
deliveries list.

## Limits and observability

100 deliveries/s per tenant, then queueing (not drops). Every delivery lists
its attempts with response codes in the dashboard and via List deliveries.

## Open issues

- **Secret rotation.** Options: dual-secret window or immediate cutover.
  Proposal: dual-secret with 24 h overlap, standard practice. Next step:
  confirm dashboard scope.

## Alternatives considered

- **Long polling.** Rejected: keeps partner infra polling-shaped and does
  not fix latency at low intervals.
- **Exactly-once delivery.** Rejected as a promise we cannot keep across
  partner outages; at-least-once with stable ids is honest and standard.
