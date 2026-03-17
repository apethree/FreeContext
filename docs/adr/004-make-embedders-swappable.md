---
title: "ADR 004: Swappable Embedders"
---

# ADR 004: Keep embedders swappable and storage embedder-agnostic

## Status

Accepted

## Context

Phase 2 adds LanceDB for persistent retrieval and a swappable embedding layer.
The retrieval backend and the embedding backend solve different problems:

- LanceDB stores symbol rows and executes full-text / vector / hybrid queries
- The embedder converts text into vectors

Hardwiring LanceDB to a single embedding model would make future model changes expensive and would couple storage concerns to model concerns.

## Decision

Keep the existing `Embedder` interface and make embedder selection configurable.

- `LanceDbStorage` remains embedder-agnostic
- `OllamaEmbedder` is the default local implementation
- Other embedders can be added behind the same interface without changing storage behavior

## Consequences

- Storage and embedding can evolve independently
- Reindexing can be enforced when the active embedding model changes
- The default embedding backend can change without becoming a hard dependency in the storage layer
