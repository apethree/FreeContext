---
title: "ADR 002: Memory Storage First"
---

# ADR 002: Implement MemoryStorage before LanceDbStorage

**Status**: Accepted
**Date**: 2026-03-15

---

## Context

The `IndexStorage` interface needs at least one concrete implementation before the indexer and search service can be tested.

LanceDB is the target production storage (vector search, on-disk persistence), but it introduces a native module dependency (`@lancedb/lancedb`) and requires Arrow serialization.

---

## Decision

Implement `MemoryStorage` in Phase 1. Defer `LanceDbStorage` to Phase 2.

---

## Rationale

- `MemoryStorage` is ~70 lines of plain TypeScript, zero native dependencies
- All interface contracts can be fully tested against it
- Phase 1 can ship and be verified without any vector DB setup
- Switching storage backends requires only injecting a different `IndexStorage` into `CodeIntelEngine`

---

## Consequences

- Phase 1 does not persist the index across CLI invocations — each `index` command rebuilds from scratch in memory
- The `search` CLI command re-indexes before every query (acceptable for Phase 1 validation)
- Phase 2 will add `--storage lancedb` flag and persist to `.lancedb/` in the project directory
