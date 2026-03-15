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
  │(Commander)│                         │  (Phase 4)     │
  └──────────┘                          └────────────────┘
```

---

## Data flow: indexing

1. `NodeFileProvider.listFiles(root)` — walks the filesystem, returns relative paths
2. `NodeFileProvider.readFile(path)` — reads source content
3. `TreeSitterParser.parseFile(path, content)` — returns `ParsedSymbol[]`
4. `contentHash(rawText)` — produces a 16-char SHA-256 hex hash per symbol
5. `Embedder.embedTexts(texts)` — produces embedding vectors (no-op in Phase 1)
6. `IndexStorage.deleteSymbolsByFile` + `upsertSymbols` — replaces old symbols for the file

---

## Data flow: querying

1. `SearchService.search({ text, filePath, symbolKind, limit })` → `CodeSymbolRow[]`
2. In Phase 2: hybrid path — exact text match ranked alongside vector cosine match (RRF fusion)
3. In Phase 3: graph queries resolve edges via `storage.getEdgesFrom/getEdgesTo`

---

## Extension points

All key components are interface-typed. You can swap:

| Interface | Default impl | Phase 2+ impl |
|-----------|-------------|---------------|
| `FileProvider` | `NodeFileProvider` | any custom |
| `LanguageParser` | `TreeSitterParser` | any language |
| `Embedder` | `NoopEmbedder` | `LocalEmbedder` |
| `IndexStorage` | `MemoryStorage` | `LanceDbStorage` |
| `ChangeTracker` | — | `GitChangeTracker` |

See [PLAN.md](../../PLAN.md) for phase-by-phase breakdown.
