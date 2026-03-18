# ADR-0006 Data Storage Strategy

- Status: Accepted
- Date: 2026-02-24

## Decision

- D1 for relational tenant state.
- R2 for large objects and payload references.
- DO Storage for short-lived hot cache and wake recovery.

## Rationale

Separates queryable metadata from large blobs and keeps realtime paths warm.

## Consequences

- Needs background flush logic from DO storage cache to D1.
- Needs lifecycle and retention policies per tenant.
