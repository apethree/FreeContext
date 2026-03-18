# ADR-0003 Identity and Authorization Model

- Status: Accepted
- Date: 2026-02-24

## Decision

- Operator auth: Clerk JWT verified at edge.
- Node auth: paired device token + device signature verification.
- Authorization: scopes attached per connection and checked per method.

## Rationale

Matches existing OpenClaw protocol semantics while supporting hosted tenancy and role mapping.

## Consequences

- Requires device registry and rotation flows in D1.
- Requires strict replay protection in challenge flow.
