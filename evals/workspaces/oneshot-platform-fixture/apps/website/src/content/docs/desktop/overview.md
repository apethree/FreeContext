---
title: Desktop App Overview
description: An overview of the OneShot desktop app features.
---

The OneShot desktop app is a native Electron application for macOS, Windows, and Linux. It runs AI inference locally using your own API keys with no cloud round-trips.

## Key features

### Local inference

When the local runtime is available, all inference runs on your machine. Messages are sent directly to your AI provider (OpenAI, Anthropic, Gemini) and the response streams back in real time. Results are synced to the cloud afterward for history and cross-device access.

### Session history

Every conversation is stored as a session. Sessions persist across app restarts and are synced to the cloud. You can search, scroll, and continue any past conversation.

### Provider switching

Switch between OpenAI, Anthropic, and Gemini within any session. Each provider uses your own API key — configured once in Settings.

### Cloud fallback

If the local runtime is unavailable, OneShot automatically falls back to cloud inference. Your conversations continue uninterrupted.

## Interface overview

```
┌─────────────────────────────────────────────────┐
│  Sidebar      │  Chat window                     │
│               │                                  │
│  ● Sessions   │  [Session title]                 │
│    - Chat 1   │                                  │
│    - Chat 2   │  User: Hello                     │
│               │  AI: Hi there! How can I help?   │
│  ● Providers  │                                  │
│  ● Channels   │  [Input field]          [Send]   │
│  ● Settings   │                                  │
└─────────────────────────────────────────────────┘
```
