# ADR-0005 Async Work and Queue Topology

- Status: Accepted
- Date: 2026-02-24

## Decision

Use Cloudflare Queues for async workloads with separate inbound/outbound queue lanes.

## Rationale

- Isolates webhook and channel latency from realtime websocket traffic.
- Gives retry semantics and batch controls with minimal infra complexity.

## Consequences

- Queue delivery is at-least-once; idempotency keys are mandatory.
- Large payloads must be stored in R2 and passed by reference.
