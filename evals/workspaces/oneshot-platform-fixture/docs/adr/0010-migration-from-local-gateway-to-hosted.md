# ADR-0010 Migration from Local Gateway to Hosted

- Status: Accepted
- Date: 2026-02-24

## Decision

Migrate in phases while preserving OpenClaw protocol compatibility for clients.

## Rationale

Reduces risk and allows rollback at each stage.

## Consequences

- Stage 1: hosted websocket gateway with no channel migration.
- Stage 2: inbound/outbound queue paths.
- Stage 3: tenant-scoped persistence and quotas.
- Stage 4: connector migration and deprecation of local-only assumptions.
