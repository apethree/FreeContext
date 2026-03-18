# CapZero Gateway Architecture

## Overview

The CapZero Gateway is a multi-tenant backend running on **Fly.io** as three cooperating
Node.js 22 services sharing PostgreSQL, Redis, and S3-compatible object storage.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Fly.io Platform                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  gateway-     │  │  gateway-     │  │  gateway-workers     │  │
│  │  realtime     │  │  api          │  │  (BullMQ consumers)  │  │
│  │  (WebSocket)  │  │  (HTTP)       │  │                      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     Shared Layer                         │    │
│  │  PostgreSQL  ·  Redis  ·  BullMQ  ·  S3 (Tigris)       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Services

### gateway-realtime

WebSocket server handling persistent client connections.

- **Auth**: Clerk JWT verification with challenge/connect handshake
- **RPC dispatch**: JSON-RPC frame protocol (`req`/`res`/`event`)
- **Tenant ownership**: Redis-fenced lease manager with Lua CAS
- **Turn leasing**: Per-session device turn locks (300s TTL)
- **Token vault**: Encrypted provider tokens in PostgreSQL + Redis cache
- **Channel management**: `channel.upsert`, `channel.delete`, `channel.probe`, `channel.status` RPCs
  with OpenClaw plugin hooks (apply, destroy, probe)

Implemented RPCs:
- `health.ping`, `health.echo`, `node.ping`, `device.register`
- `debug.snapshot`
- `session.upsert`, `chat.append`, `chat.send`, `chat.history`, `sync.catchup`
- `turn.acquire`, `turn.heartbeat`, `turn.release`
- `token.sync.push`, `token.sync.pull`, `token.sync.delete`
- `provider.probe`
- `channel.upsert`, `channel.list`, `channel.delete`, `channel.status`, `channel.probe`
- `hook.route.list|upsert|delete`, `hook.event.list`, `hook.agent.list|upsert|delete`

### gateway-api

HTTP server for webhook ingress and administrative endpoints.

- **Hook ingress**: `POST /hooks/:hookName` — token-authenticated webhook receiver
- **Inbound ingress**: `POST /webhooks/inbound` — channel event receiver, deduped via idempotency
- **Hook transform runtime**: JavaScript sandboxed transforms for payload mapping
- **Hook agent runtime**: Autonomous agent sessions triggered by webhook events
- **Admin ops**: `/ops/hooks/routes`, `/ops/hooks/events`, `/ops/hooks/agents`

### gateway-workers

BullMQ job consumers for async work.

- **Inbound worker**: Dequeues inbound events → normalizes via channel plugin → delivers to
  realtime server via internal signed HTTP
- **Outbound worker**: Dequeues outbound jobs → delivers via channel plugin or webhook →
  updates job status in PostgreSQL

## Data Layer

| Store | Purpose | Details |
|---|---|---|
| **PostgreSQL** | Primary persistence | Sessions, messages, channels, jobs, devices, tokens, hook routes/events/agents, idempotency keys |
| **Redis** | Hot state + queues | Tenant ownership leases, turn leases, session/event sequences, token cache, BullMQ queues |
| **S3 (Tigris)** | Object storage | Large payloads, transcript archives |

## Authentication & Authorization

- **Client auth**: Clerk-issued JWTs verified against JWKS endpoint
- **Internal auth**: HMAC-SHA256 signed delivery between services
- **Hook auth**: Per-route token hashing with timing-safe comparison, rate limiting
- **Token vault**: AES-256-GCM encrypted provider tokens at rest in PostgreSQL

## Tenant Isolation

Each tenant has a Redis-fenced ownership lease. Only one Fly machine "owns" a tenant at
a time (Lua CAS). When a client connects, the realtime server acquires the lease and drains
any inbound backlog accumulated while the tenant was unowned.

---

## Channel Integration (OpenClaw Plugins)

Channel delivery is a core subsystem of the gateway. Instead of hardcoded HTTP calls per
channel type, the gateway bundles **OpenClaw channel plugins** as an npm dependency
(`openclaw`). This means channel support upgrades come from `npm update openclaw` — no
separate microservice.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     apps/gateway/src/channels/                │
│                                                               │
│  ┌─────────────────┐  ┌───────────────────┐                 │
│  │ channel-plugin.ts│  │ plugin-registry.ts │                 │
│  │ (ChannelPlugin   │  │ (PLUGIN_REGISTRY   │                 │
│  │  interface)      │  │  Map + dispatch)   │                 │
│  └─────────────────┘  └────────┬──────────┘                 │
│                                 │                             │
│  ┌──────────────────────────────▼──────────────────────────┐ │
│  │              openclaw-bridge.ts                          │ │
│  │  Imports openclaw/plugin-sdk → wraps each channel       │ │
│  │  into ChannelPlugin interface                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                 │                             │
│  ┌──────────────────────────────▼──────────────────────────┐ │
│  │              openclaw (npm dependency)                   │ │
│  │  grammy · @slack/bolt · discord-api-types · baileys     │ │
│  │  signal-cli · BlueBubbles · IRC · Google Chat           │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### ChannelPlugin Interface

Every channel plugin implements 5 operations:

| Operation | When Called | Purpose |
|---|---|---|
| `apply(input)` | `channel.upsert` RPC | Initialize/configure the channel runtime (e.g., resolve bot account) |
| `probe(input)` | `channel.probe` RPC | Health-check the channel (e.g., Telegram `getMe`, Slack `auth.test`) |
| `send(input)` | Outbound worker job | Deliver a message to the external channel |
| `destroy(input)` | `channel.delete` RPC | Tear down channel runtime before DB deletion |
| `normalizeInbound(input)` | Inbound worker job | Parse platform-specific webhook payload into normalized `{ text, senderId, senderName }` |

### Plugin Registry

At startup, both `gateway-realtime` and `gateway-workers` call `initPluginRegistry()`.
This imports `openclaw/plugin-sdk`, iterates registered channels, and wraps each into
a `ChannelPlugin` adapter stored in `PLUGIN_REGISTRY` (a `Map<string, ChannelPlugin>`).

Runtime dispatch:
```typescript
import { hasPlugin, dispatchPlugin } from "../channels/plugin-registry.js";

if (hasPlugin(channelType)) {
  const result = await dispatchPlugin(channelType, "send", { ... });
}
```

### Supported Channels

**Core 8** (bundled with `openclaw`):

| Channel | Type ID | Underlying SDK |
|---|---|---|
| Telegram | `telegram` | grammy, @grammyjs/runner |
| Discord | `discord` | discord-api-types, @discordjs/voice |
| Slack | `slack` | @slack/bolt, @slack/web-api |
| WhatsApp | `whatsapp` | @whiskeysockets/baileys (QR pairing) |
| Signal | `signal` | signal-cli REST bridge |
| iMessage | `imessage` | BlueBubbles REST |
| IRC | `irc` | raw TCP |
| Google Chat | `googlechat` | HTTP webhook |

**Extended** (via plugin install or bundled):
- MS Teams (`@openclaw/msteams`), Matrix, Nostr, Feishu, Line, Mattermost

### Data Flow: Outbound Delivery

```
chat.send RPC
  → append assistant message to PostgreSQL
  → enqueue OutboundJob to BullMQ
  → outbound-worker dequeues
  → loadChannel(pg, tenantId, channelId) → { type, config }
  → if type === "webhook": deliverViaWebhook(url, body)
    else if hasPlugin(type): dispatchPlugin(type, "send", { config, targetId, payload })
    else: throw "no handler"
  → UPDATE jobs SET status = 'completed'
```

### Data Flow: Inbound Normalization

```
POST /webhooks/inbound
  → dedup via idempotency key
  → enqueue InboundJob to BullMQ
  → inbound-worker dequeues
  → resolve tenant owner from Redis
  → if hasPlugin(source):
      query channel config from PostgreSQL
      dispatchPlugin(source, "normalizeInbound", { payload, config })
      → enriches payload with { _normalized, text, senderId, senderName }
  → POST /internal/deliver to realtime server (HMAC-signed)
  → realtime broadcasts to WebSocket connections + runs hook actions
```

### Channel Lifecycle

```
channel.upsert RPC
  → INSERT/UPDATE channels table
  → if hasPlugin(type): dispatchPlugin(type, "apply", { config, isActive })
  → return { ok, channelId, type }

channel.probe RPC
  → SELECT channel from PostgreSQL
  → if webhook/relay: { ok, skipped: true }
  → if hasPlugin(type): dispatchPlugin(type, "probe", { config })
  → return { ok, probe: { ok, elapsedMs, detail } }

channel.delete RPC
  → SELECT channel (need type + config for teardown)
  → if hasPlugin(type): dispatchPlugin(type, "destroy", { config })
  → DELETE FROM channels
  → return { ok, deleted }
```

### Upgrading Channel Plugins

```bash
npm --prefix apps/gateway update openclaw
npm --prefix apps/gateway run build
fly deploy --config apps/gateway/deploy/fly.workers.toml
fly deploy --config apps/gateway/deploy/fly.realtime.toml
```

No manual plugin management. Channel plugin code upgrades automatically with the
`openclaw` dependency.

---

## Deployment

### Fly.io Topology

Each service has its own `fly.toml`:
- `deploy/fly.realtime.toml` — WebSocket server, `SERVICE_NAME=gateway-realtime`
- `deploy/fly.api.toml` — HTTP API, `SERVICE_NAME=gateway-api`
- `deploy/fly.workers.toml` — BullMQ workers, `SERVICE_NAME=gateway-workers`

All share the same Docker image. The entrypoint (`src/start.ts`) routes by `SERVICE_NAME`.

### Environment Variables

| Variable | Service | Purpose |
|---|---|---|
| `SERVICE_NAME` | all | Process selector (`gateway-realtime`, `gateway-api`, `gateway-workers`) |
| `PORT` | all | Listen port (default 8080) |
| `CLERK_JWKS_URL` | realtime | Clerk JWKS endpoint for JWT verification |
| `CLERK_ISSUER` | realtime | Expected JWT issuer |
| `PG_URL` | all | PostgreSQL connection string |
| `REDIS_URL` | all | Redis connection string |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_*` | workers | S3-compatible object storage |
| `TENANT_TOKEN_ENCRYPTION_KEY_BASE64` | realtime | AES-256-GCM key for token vault |
| `INTERNAL_DELIVERY_SECRET` | all | HMAC key for inter-service delivery |
| `MACHINE_ID` | all | Fly machine ID (auto-detected via `FLY_MACHINE_ID`) |

---

## ADRs

Architecture Decision Records are in [`docs/adr/`](../adr/README.md):

- ADR-0001: Project boundaries and repo layout
- ADR-0002: Multi-tenant isolation boundary
- ADR-0003: Identity and authorization model
- ADR-0004: Realtime transport and session routing
- ADR-0005: Async work and queue topology
- ADR-0006: Data storage strategy
- ADR-0007: Channel connector execution model
- ADR-0008: Security, secrets, and crypto boundaries
- ADR-0009: Observability, SLOs, and operability
- ADR-0010: Migration from local gateway to hosted
