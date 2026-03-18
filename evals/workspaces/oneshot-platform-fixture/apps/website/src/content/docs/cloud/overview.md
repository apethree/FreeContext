---
title: Cloud Overview
description: How the OneShot cloud gateway works.
---

The OneShot cloud gateway runs on Cloudflare Workers + Durable Objects. It provides session sync, channel support, and cloud inference for when your desktop app is offline.

## Architecture

```
 One Shot Desktop ──── wss://ws.capzero.com ────► Worker
                                                      │
                                              TenantGateway DO
                                              ├── DO SQLite (sessions)
                                              ├── DO KV (tokens, leases)
                                              └── R2 (transcript archive)
                                                      │
                                              ┌───────┼───────┐
                                             D1      Queue    Clerk
                                         (channels,  (outbound  (auth)
                                          devices,    delivery)
                                          jobs)
```

**One DO per tenant.** Your data is completely isolated from other tenants at the infrastructure level — not just at the application layer.

## What the cloud handles

| Scenario | Where | Why |
|----------|-------|-----|
| Interactive chat (local runtime running) | Local | No round-trip. Sync result to cloud afterward. |
| Interactive chat (no local runtime) | Cloud | Fallback. |
| Channel inbound (Discord, Slack, etc.) | Cloud | Must work 24/7. Laptop may be closed. |
| Session history reads | Cloud (DO SQLite + R2) | Cloud is source of truth. |

## Pricing transparency

OneShot runs on Cloudflare's infrastructure. At 300M turns/month the infrastructure cost is ~$1,400/month — well within the platform budget. LLM inference costs are paid directly by you via your own API keys.
