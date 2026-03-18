# ADR-0004 Realtime Transport and Session Routing

- Status: Accepted
- Date: 2026-02-24

## Decision

Use Cloudflare Workers + Durable Objects WebSocket hibernation for tenant realtime ingress.
Canonical production endpoint is `wss://ws.capzero.com/ws`.
Tenant context is derived from Clerk auth claims, not URL path naming.

## Rationale

- Keeps live chat low-latency and bidirectional.
- Minimizes idle resource burn with DO hibernation.

## Consequences

- Must enforce backpressure and slow-client handling in DO broadcast paths.
- Must keep CPU-heavy work off websocket request paths.
