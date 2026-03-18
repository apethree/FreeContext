# ADR-0009 Observability, SLOs, and Operability

- Status: Accepted
- Date: 2026-02-24

## Decision

Adopt structured logs, queue lag metrics, websocket connection metrics, and per-tenant usage counters from day one.

## Rationale

Operational visibility is required before scaling tenant count.

## Consequences

- Define SLO baselines for websocket latency, queue age, and delivery success.
- Build dead-letter and replay tooling for queue failures.
