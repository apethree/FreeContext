# OneShot Platform Project Context

This file is a carry-over summary for new sessions/agents.

## Active Repository
- Path: `/Users/narya/github/oneshot-platform`
- Remote: `https://github.com/apethree/oneshot-platform.git`
- Legacy repo to ignore for current work: `/Users/narya/github/oneshot-platform-legacy`

## Current Focus
Build a hosted multi-tenant OpenClaw architecture with:
- `apps/gateway`: Node.js gateway (Fly.io) + PostgreSQL + Redis + BullMQ + Clerk auth
- `apps/one-shot`: Electron client with hosted-phase testing page and local OpenClaw runtime integration

## Architecture / ADR Docs
- Gateway architecture: `apps/gateway/docs/architecture-v2.md`
- One Shot runtime/hosted-phase architecture: `apps/one-shot/docs/architecture.md`
- ADR index: `docs/adr/README.md`
- ADRs:
  - `0001-project-boundaries-and-repo-layout.md`
  - `0002-multi-tenant-isolation-boundary.md`
  - `0003-identity-and-authorization-model.md`
  - `0004-realtime-transport-and-session-routing.md`
  - `0005-async-work-and-queue-topology.md`
  - `0006-data-storage-strategy.md`
  - `0007-channel-connector-execution-model.md`
  - `0008-security-secrets-and-crypto-boundaries.md`
  - `0009-observability-slos-and-operability.md`
  - `0010-migration-from-local-gateway-to-hosted.md`

## Gateway Implementation Highlights
- HTTP API + WebSocket realtime server + BullMQ workers
- Clerk JWT auth + tenant resolution
- RPC method dispatch with challenge/connect flow
- PostgreSQL for persistence, Redis for leases/sequences
- OpenClaw channel plugins bundled via `openclaw` dependency
- Queue inbound/outbound workers with plugin-based channel delivery
- Internal signed delivery/auth context helpers

## One Shot Testing + Runtime
- Hosted phase smoke tests:
  - `apps/one-shot/tests/electron/openclaw-hosted-phase.smoke.spec.ts`
  - `apps/one-shot/scripts/test-hosted-phase-clerk-users.sh`
- Local runtime packaging scaffold:
  - `apps/one-shot/resources/openclaw-runtime/README.md`
  - `apps/one-shot/scripts/prepare-openclaw-runtime.mjs`

## Next Workstream (expected)
1. Complete Phase 3 validation end-to-end (chat + channel connectors).
2. Improve hosted test page chat sandbox and channel connect UX.
3. Stabilize local runtime ownership/start-stop behavior in Electron.
4. Prepare Phase 4 fallback execution and token vault sync hardening.
