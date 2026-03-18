---
title: Connecting Providers
description: How to add OpenAI, Anthropic, and Gemini API keys.
---

OneShot works with the three major AI providers. You supply your own API key — OneShot never sees your keys in plaintext; they are encrypted and stored in your Durable Object.

## Supported providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, GPT-4o mini, o1, o3 |
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku |
| Gemini | Gemini 2.0 Flash, Gemini 1.5 Pro |

## Adding a provider

1. Open the desktop app and go to **Settings → Providers**
2. Click **Add provider**
3. Select the provider (OpenAI, Anthropic, or Gemini)
4. Paste your API key
5. Click **Save**

Your key is encrypted with AES-256-GCM and stored in your cloud Durable Object. It's never logged or sent to OneShot servers.

## Getting API keys

- **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Anthropic**: [console.anthropic.com](https://console.anthropic.com)
- **Gemini**: [aistudio.google.com](https://aistudio.google.com) or Google Cloud OAuth
