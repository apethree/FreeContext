---
title: Architecture Overview
---

# Architecture Overview

FreeContext is a pipeline of composable, interface-driven modules. All data flows in one direction: files → symbols → storage → queries.

---

## Component map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CodeIntelEngine                              │
│  (public façade — composes all modules, exposes top-level API)       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  ┌───────────┐          ┌────────────┐          ┌─────────────┐
  │  Indexer  │          │  Search    │          │   Graph     │
  │           │          │  Service   │          │  Queries    │
  └─────┬─────┘          └─────┬──────┘          └──────┬──────┘
        │                      │                         │
        ▼                      └──────────┬──────────────┘
  ┌─────────────────────────────▼─────────────────────────────┐
  │                      IndexStorage                          │
  │         MemoryStorage (Phase 1) / LanceDbStorage (Phase 2) │
  └────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌───────────┐   ┌─────────────┐   ┌──────────────┐
  │ FileProvider│  │LanguageParser│  │   Embedder   │
  │(NodeFile...) │  │(TreeSitter)  │  │(Noop/Local)  │
  └───────────┘   └─────────────┘   └──────────────┘

        ▼                                        ▼
  ┌──────────┐                          ┌────────────────┐
  │   CLI    │                          │   MCP Server   │
  │(Commander)│                         │ (Streamable HTTP)│
  └──────────┘                          └────────────────┘
```

---

## Data flow: indexing

1. `NodeFileProvider.listFiles(root, extensions, ignore)` — walks the filesystem, applies extension and ignore filters, returns relative paths
2. `NodeFileProvider.readFile(path)` — reads source content
3. `contentHash(content)` — produces a stable file hash before parsing
4. If the stored `file_summary` hash matches, the file is skipped
5. `TreeSitterParser.parseFile(path, content)` — returns `ParsedSymbol[]`, including import bindings and inheritance references, with a chunked-input fallback for large files that exceed the direct string parse limit in the current tree-sitter runtime
6. The indexer writes deterministic symbol IDs plus one generated `file_summary` row per file
7. `Embedder.embedTexts(texts)` — produces embedding vectors when enabled
8. `IndexStorage.deleteSymbolsByFiles` + batched `upsertSymbols` — replaces changed-file symbols in larger write batches instead of one file at a time
9. The indexer loads a repo-wide exact-name `RepoSymbolMap` from storage after symbol writes
10. `EdgeExtractor` runs after symbol writes and resolves repo-wide fallback references from the in-memory map before touching storage
11. Batched `upsertEdges` writes the resulting `calls`, `imports`, `extends`, and `implements` edges
12. LanceDB bulk deletes are chunked by predicate size, and freshly created tables skip the redundant delete/re-add pass during the same write

---

## Data flow: querying

1. `SearchService.search({ text, filePath, pathPrefix, symbolKind, mode, limit })` → `CodeSymbolRow[]`
2. In Phase 2: LanceDB can serve full-text, semantic, and hybrid retrieval against persisted symbol rows
3. Hybrid retrieval combines full-text and vector results with reciprocal rank fusion (RRF)
4. `SearchService.searchPaths({ query, pathPrefix, limit })` returns indexed file paths for file-discovery queries
5. In Phase 3: `GraphService` resolves callers, callees, and codebase summaries via `storage.getEdgesFrom/getEdgesTo`
6. `GitChangeTracker` maps `git diff` output back to indexed symbols for `recently-changed`
7. In Phase 4: `FreeContextMcpServer` exposes the engine over Streamable HTTP at `/mcp`

---

## Extension points

All key components are interface-typed. You can swap:

| Interface | Default impl | Phase 2+ impl |
|-----------|-------------|---------------|
| `FileProvider` | `NodeFileProvider` | any custom |
| `LanguageParser` | `TreeSitterParser` | any language |
| `Embedder` | `NoopEmbedder` | `OllamaEmbedder`, `RemoteEmbedder`, remote providers |
| `IndexStorage` | `MemoryStorage` | `LanceDbStorage` |
| `ChangeTracker` | `GitChangeTracker` | any git-aware or VCS-aware source |

See [PLAN.md](../../PLAN.md) for phase-by-phase breakdown.
