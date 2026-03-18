# ADR-0008 Security, Secrets, and Crypto Boundaries

- Status: Accepted
- Date: 2026-02-24

## Decision

- Store runtime secrets in Cloudflare secrets, not config files.
- Encrypt connector credentials before persisting to D1.
- Require signed webhook verification and replay windows.

## Rationale

Hosted multi-tenant environments require explicit crypto and secret hygiene boundaries.

## Consequences

- Introduces key management and rotation requirements.
- Adds signature verification middleware to all ingress paths.
