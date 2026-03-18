# ADR-0007 Channel Connector Execution Model

- Status: Accepted
- Date: 2026-02-24

## Decision

Define three connector modes: `webhook`, `worker`, and `external-connector`.

## Rationale

Not all channel providers fit serverless runtime constraints equally.

## Consequences

- Webhook-first channels run fully on Workers.
- Long-lived or incompatible channels can run as external connectors and publish events to inbound queue.
