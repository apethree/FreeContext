---
title: "Introducing OneShot"
description: "We're building the AI assistant platform that lives everywhere — on your device, in your channels, and in the cloud."
date: 2025-02-27
author: CapZero Team
tags: [announcement, product]
---

We're excited to introduce **OneShot** — an AI assistant platform designed to work the way you actually work.

## The problem we're solving

Every AI assistant today forces you to pick a lane: use the cloud app, or use the API. Local tools are fast but don't persist. Cloud tools persist but have latency. Channel bots (Discord, Slack) stop working when your laptop closes.

We think you shouldn't have to choose.

## How OneShot works

OneShot has three layers:

1. **Desktop app** — A native Electron app that runs inference locally using your own API keys. Fastest possible response time. No cloud round-trips.

2. **Cloud gateway** — A multi-tenant Cloudflare Durable Objects backend that keeps sessions in sync across all your devices. When your laptop is closed, your channels keep working.

3. **Channels** — Connect Discord, Slack, Telegram, or any webhook. The cloud gateway handles channel traffic even when you're offline.

## Built on your keys

We never store or proxy your API keys to LLM providers. You connect your own OpenAI, Anthropic, or Gemini API key. We encrypt it in your Durable Object and use it only when you initiate a request.

## What's next

We're in private beta. If you want early access, [read the docs](/getting-started/introduction/) and get in touch.
