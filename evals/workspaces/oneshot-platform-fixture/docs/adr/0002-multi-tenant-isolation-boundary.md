# ADR-0002 Multi-tenant Isolation Boundary

- Status: Accepted
- Date: 2026-02-24

## Decision

Use Clerk `org_id` as canonical `tenant_id`, and route each tenant to a dedicated TenantGateway DO namespace key (`idFromName(tenant_id)`).
Do not encode tenant identity in public websocket URL path segments.

## Rationale

- Single source of truth for tenancy identity.
- Predictable routing and connection fanout per tenant.

## Consequences

- Large tenants may require future shard keys (`tenant_id:shard_id`).
- Every DB query and object path must include `tenant_id`.
