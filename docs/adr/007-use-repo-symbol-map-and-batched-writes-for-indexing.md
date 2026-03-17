---
title: Use Repo Symbol Map And Batched Writes For Indexing
---

# ADR 007: Use Repo Symbol Map And Batched Writes For Indexing

## Status

Accepted

## Context

Cold LanceDB indexing on larger repos spent most of its time in the edge phase, not parsing or raw symbol writes. The main cause was an N+1 access pattern in edge resolution: unresolved references were calling storage search repeatedly inside the per-reference loop.

At the same time, the indexer was deleting and upserting symbols one file at a time, which created unnecessary write overhead for LanceDB.

## Decision

Use two complementary fixes:

1. After symbol rows are written, load repo symbols once and build an in-memory `RepoSymbolMap` keyed by exact symbol name.
2. Batch changed-file symbol writes and edge writes instead of writing one file at a time.

Also add a scalar LanceDB index on `symbolName` to support exact-name lookups efficiently when storage-based lookup is still needed.

## Consequences

- Repo-wide edge fallback resolution becomes memory-bound instead of database-bound.
- Cold indexing scales better on larger repos.
- The indexer uses more peak memory during a full rebuild, but the tradeoff is acceptable for the current TS/JS repo sizes this project targets.
- Automatic `optimize()` is not enabled by default. Compaction can be revisited separately once it is proven stable in the target runtime.
