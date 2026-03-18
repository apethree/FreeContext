---
title: Sessions & History
description: How sessions work and how history is stored.
---

A **session** is a conversation thread in OneShot. Sessions persist across app restarts, sync to the cloud, and can span months of context.

## How history is stored

OneShot uses a two-tier storage model:

1. **Hot buffer** (Cloudflare DO SQLite) — recent messages stored in a `pending_messages` column. Instant read access.

2. **Cold archive** (Cloudflare R2) — messages older than ~50 turns are flushed from the buffer, gzip-compressed, and stored as immutable JSONL segments. Reads are fast because segments are indexed by a manifest file.

When you scroll up in a session, OneShot automatically merges messages from both tiers.

## Sequence numbers

Every message in a session has a monotonically increasing sequence number (`seq`). This ensures deterministic ordering even across multiple devices or concurrent writes.

## Searching history

Use **Cmd/Ctrl+K** to open the command palette and search across all sessions. Search is local — your message content never leaves your device.

## Deleting sessions

To delete a session, right-click it in the sidebar and choose **Delete session**. This removes the session row and its pending messages from DO SQLite. R2 segments are not automatically deleted (for cost reasons) but will be garbage collected in a future update.
