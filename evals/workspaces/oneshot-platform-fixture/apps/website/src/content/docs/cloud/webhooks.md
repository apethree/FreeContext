---
title: Webhooks
description: Receiving inbound webhooks and sending outbound requests.
---

OneShot supports inbound webhooks for triggering AI responses from external systems.

## Inbound webhook endpoint

```
POST https://api.capzero.com/deliver
```

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-CapZero-Tenant` | Your tenant ID |
| `X-CapZero-Secret` | Your webhook secret |

### Body

```json
{
  "event": "channel.inbound",
  "channelId": "ch_abc123",
  "payload": {
    "from": "user@example.com",
    "text": "Hello, can you help me with..."
  }
}
```

### Response

```json
{
  "ok": true,
  "jobId": "job_xyz789",
  "status": "queued"
}
```

## Outbound delivery

After the AI responds, OneShot delivers the response to your channel's configured endpoint. You can inspect delivery status and retry failed jobs from the desktop app under **Settings → Channels → Jobs**.

## Security

- Webhook secrets are encrypted at rest in your Durable Object
- All inbound requests are validated against your tenant secret
- Outbound delivery uses HTTPS only
