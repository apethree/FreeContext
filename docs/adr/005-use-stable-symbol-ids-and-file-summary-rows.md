---
title: Use Stable Symbol IDs and File Summary Rows
---

# ADR 005: Use Stable Symbol IDs and File Summary Rows

## Status

Accepted

## Context

Phase 3 adds two features that interact directly:

- graph edges that point from one symbol to another
- incremental indexing that rewrites one file at a time

If symbol IDs are random on every re-index, cross-file edges become stale as soon as the target file is re-indexed. We also need a file-level change signal so we can skip unchanged files without parsing and embedding them again.

## Decision

FreeContext now uses:

- deterministic hash-based symbol IDs derived from repo, file path, symbol kind, symbol name, and occurrence order within the file
- deterministic hash-based edge IDs derived from repo, file path, source symbol ID, target symbol ID, and edge kind
- one generated `file_summary` row per file, whose `hash` stores the full-file content hash

## Consequences

- graph edges remain valid across many re-indexes as long as symbol identity in the file stays stable
- incremental indexing can skip unchanged files by comparing the stored `file_summary.hash` against the new file hash
- `file_summary` rows are internal indexing records and are filtered out from normal search results unless explicitly requested
- symbol identity is still heuristic rather than globally canonical; large declaration reorderings can still change IDs, but this is simpler and cheaper than introducing SCIP or compiler-level symbol resolution in Phase 3
