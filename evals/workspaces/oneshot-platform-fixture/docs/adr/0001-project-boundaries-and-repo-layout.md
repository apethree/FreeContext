# ADR-0001 Project Boundaries and Repo Layout

- Status: Accepted
- Date: 2026-02-24

## Decision

Use `apps/gateway` as the hosted backend boundary and `apps/one-shot` as the client/runtime boundary.

## Rationale

- Keep hosted gateway code isolated from the Electron app and local runtime packaging concerns.
- Preserve a single hosted backend surface for API, realtime, workers, and channel execution.

## Consequences

- Hosted channel execution, queues, and realtime transport live under `apps/gateway`.
- Desktop app changes stay focused on client UX, local runtime ownership, and testing surfaces.
