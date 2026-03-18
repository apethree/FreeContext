---
title: Channels
description: Connect Discord, Slack, Telegram, and webhooks to OneShot.
---

Channels let OneShot respond to messages from external platforms. Channel responses are handled by the cloud gateway — so they work even when your desktop app is offline.

## Supported channels

| Channel | Status |
|---------|--------|
| Discord | Beta |
| Slack | Beta |
| Telegram | Coming soon |
| Generic webhook | Beta |

## Setting up a channel

1. Go to **Settings → Channels** in the desktop app
2. Click **Add channel**
3. Select the channel type (Discord, Slack, or Webhook)
4. Fill in the required credentials (bot token, webhook URL, etc.)
5. Click **Save** — the channel config is synced to the cloud

## How it works

When a message arrives on a channel:

1. The inbound webhook hits `POST /deliver` on the cloud Worker
2. The Worker routes it to your `TenantGateway` Durable Object
3. The DO runs `chat.send` with your configured AI provider
4. The response is enqueued on the outbound queue
5. The queue consumer delivers the response back to the channel

## Delivery guarantees

Channel messages are persisted as jobs in D1 before queuing. If delivery fails, the job is retried with exponential backoff up to 3 times.
