# OpenClaw Gateway (Fly migration)

This package contains the Node.js gateway runtime that replaces Cloudflare Worker + Durable Objects for production traffic.

Services:
- `gateway-realtime`: WebSocket + tenant actor + JSON-RPC method handling.
- `gateway-api`: REST/webhook ingress + ops APIs.
- `gateway-workers`: BullMQ inbound/outbound workers.

Hook ingress (Phase 1):
- `POST /hooks/:tenantId/:routePath*` (or `POST /hooks` with `tenantId` in body/query)
- Built-in OpenClaw-style routes:
  - `POST /hooks/wake?tenantId=...` (requires `text` or `message`)
  - `POST /hooks/agent?tenantId=...` (requires `message` or `text`)
- Auth token from `Authorization: Bearer <token>` or `x-openclaw-token`
- Route resolution from `hook_routes` table (path/source/name match)
- Accepted requests enqueue inbound events (`hook.wake` / `hook.agent`) for tenant delivery.
- Delivery response parity: `200` for wake/agent ingress acceptance.
- For `hook.agent`, when payload/config includes `channel` + `to` and `deliver=true`, realtime queues outbound channel delivery after assistant completion.
- Optional route transforms:
  - Set `transformModule` in route config.
  - Set `OPENCLAW_HOOKS_TRANSFORMS_DIR` to an absolute directory containing transform modules.
  - Runtime executes only modules resolved inside that directory (path-safe guard + timeout).
  - Transform output can override `message`, `sessionKey`, `agentId`, `provider`, `model`, `deliver`, `channel`, `to`, `wakeMode`, `metadata`.
  - Transform failures return `422 HOOK_TRANSFORM_ERROR`.

Ops helpers (bearer-protected):
- `GET /ops/hooks/routes?tenantId=...`
- `POST /ops/hooks/routes/upsert`
- `DELETE /ops/hooks/routes?tenantId=...&name=...`
- `GET /ops/hooks/events?tenantId=...`
- `GET /ops/hooks/agents?tenantId=...`
- `POST /ops/hooks/agents/upsert`
- `DELETE /ops/hooks/agents?tenantId=...&agentId=...`

Run locally:
- `npm --prefix apps/gateway run dev:realtime`
- `npm --prefix apps/gateway run dev:api`
- `npm --prefix apps/gateway run dev:workers`

Or run the full local stack:
- `npm --prefix apps/gateway run dev:stack:start`
- `npm --prefix apps/gateway run dev:stack:status`
- `npm --prefix apps/gateway run dev:stack:logs`
- `npm --prefix apps/gateway run dev:stack:restart`
- `npm --prefix apps/gateway run dev:stack:stop`

Stack logs and pid files are stored under `apps/gateway/.local/stack`.

Required env vars are defined in `src/shared/config.ts`.
Run SQL migrations in order: `001_init_postgres.sql`, `002_hook_routes.sql`, `003_hook_events.sql`, `004_hook_agents.sql`.
