# ADR 009 — Default local embeddings to Ollama

## Status

Accepted — 2026-03-16

## Context

FreeContext previously experimented with an in-process local embedding runtime before moving to Ollama as the default local path.
That worked, but it had two practical problems:

- first-run model downloads happened inside the CLI with weak progress visibility
- users had to care about runtime-specific local inference setup

The repo also needs a simple local default that works well with LanceDB semantic and hybrid search while keeping the embedder interface swappable.

## Decision

FreeContext now defaults `--embed` to the `ollama` embedder.

- `ollama` is the default local embedding backend
- `openai_compatible` is supported for local or remote HTTP embedding servers
- provider-backed embedders remain optional

FreeContext also validates embedding compatibility against the existing index before semantic search or embedded reindexing. If the stored model or vector dimensions do not match the active embedder, the command fails with a rebuild message instead of mixing incompatible vectors.

## Consequences

Positive:

- default local setup is simpler on Apple, CUDA, and CPU machines
- first-run behavior is easier to reason about
- progress reporting is clearer during download and embedding
- LanceDB indexes are protected from mixed-dimension or mixed-model vectors

Negative:

- the default local embed path now depends on an external local HTTP service (`ollama`)
- users now rely on Ollama or another HTTP embedding backend instead of an in-process runtime
