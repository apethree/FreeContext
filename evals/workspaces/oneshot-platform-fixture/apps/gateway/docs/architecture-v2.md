# Fly.io Gateway Migration (v2, implemented scaffold)

This package provides the Fly-target runtime split:

- `gateway-realtime` (`src/realtime/server.ts`)
- `gateway-api` (`src/api/server.ts`)
- `gateway-workers` (`src/workers/server.ts`)

## Implemented critical changes

1. WS terminates at realtime (`/ws`, `/ws-node`), not API.
2. Redis fenced tenant ownership lease manager (`src/shared/ownership.ts`) with Lua CAS.
3. Durable token vault in Postgres + Redis cache (`src/shared/token-vault.ts`).
4. Canonical session/event sequences via Redis `INCR` (`src/shared/sequence.ts`).
5. Explicit inbound backlog table + drain on reconnect (`src/shared/inbound-backlog.ts`).
6. Grace-based ownership release (`OWNER_IDLE_GRACE_MS`) instead of immediate release.
7. Hook ingress transform runtime (`src/shared/hooks-transform.ts`) with path-safe module resolution under `OPENCLAW_HOOKS_TRANSFORMS_DIR`.
8. Tenant-scoped hook agent profiles (`hook_agents` + `src/shared/hook-agents-repo.ts`) used by realtime runtime selection.

## Data model

Apply `sql/001_init_postgres.sql` to Postgres.

## Deploy

Use:
- `deploy/fly.realtime.toml`
- `deploy/fly.api.toml`
- `deploy/fly.workers.toml`

## Notes

- JSON-RPC frame contract is preserved.
- Implemented RPCs used by one-shot today:
  - `health.ping`, `debug.snapshot`
  - `session.upsert`, `chat.append`, `chat.send`, `chat.history`, `sync.catchup`
  - `turn.acquire`, `turn.heartbeat`, `turn.release`
  - `token.sync.push`, `token.sync.pull`, `token.sync.delete`
  - `channel.upsert`, `channel.list`, `channel.delete`, `channel.status`, `channel.probe`
- Any not-yet-migrated RPC still returns `METHOD_NOT_IMPLEMENTED` from realtime dispatcher.
- Hook/runtime parity additions:
  - RPC ops: `hook.route.list|upsert|delete`, `hook.event.list`, `hook.agent.list|upsert|delete`
  - REST ops: `/ops/hooks/routes*`, `/ops/hooks/events`, `/ops/hooks/agents*`
  - `runHookAction` runtime selection precedence: explicit payload/route `agentId` -> tenant hook agent profile -> default `main`.
