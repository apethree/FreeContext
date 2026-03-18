---
title: Introduction
description: What OneShot is and how it works.
---

**OneShot** is an AI assistant platform that connects your AI models to your devices, channels, and workflows.

## What makes it different

| | OneShot | Cloud-only | API-only |
|---|---|---|---|
| Local inference | ✅ | ❌ | ✅ |
| Persistent history | ✅ | ✅ | ❌ |
| Channel support | ✅ | varies | ❌ |
| Your API keys | ✅ | ❌ | ✅ |
| Works offline | ✅ | ❌ | ✅ |

## Core concepts

### Sessions

A session is a conversation thread. Messages in a session are stored in a hot buffer (DO SQLite) and flushed to long-term storage (R2) after they accumulate. You can scroll back months of context.

### Providers

OneShot connects to OpenAI, Anthropic, and Gemini using your own API keys. Keys are encrypted in your Durable Object — never on our servers.

### Channels

Channels let OneShot respond to messages from Discord, Slack, Telegram, and webhooks. The cloud gateway handles channel traffic even when your desktop app is offline.

## Next steps

- [Quick Start](/getting-started/quick-start/) — connect your first provider in 5 minutes
- [Installation](/getting-started/installation/) — download the desktop app
