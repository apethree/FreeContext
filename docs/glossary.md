---
title: Glossary
---

# Glossary

**CodeIntelEngine** — The public façade class. Entry point for all indexing and querying operations.

**CodeSymbolRow** — A single indexed symbol record: one function, class, interface, variable, etc.

**EdgeRow** — A directed relationship between two symbols (calls, imports, implements, extends).

**Embedder** — Interface responsible for converting symbol text into dense vector representations.

**FileProvider** — Interface that abstracts filesystem access. `NodeFileProvider` is the default implementation.

**IndexStorage** — Interface for persisting and querying symbols and edges. `MemoryStorage` in Phase 1, `LanceDbStorage` in Phase 2+.

**Indexer** — The pipeline that reads files, parses them, hashes content, generates embeddings, and stores symbols.

**LanguageParser** — Interface for turning source text into `ParsedSymbol[]`. `TreeSitterParser` handles TS/JS.

**LanceDB** — An embedded vector database backed by Apache Arrow. Used in Phase 2+ for on-disk semantic search.

**MCP** — Model Context Protocol. A standard for exposing tools to AI agents. FreeContext implements an MCP server in Phase 4.

**NoopEmbedder** — A no-op implementation of `Embedder` used in Phase 1. Returns empty vectors.

**repoId** — A stable string identifier for a project. Used to namespace symbols when multiple projects share the same storage.

**RRF** — Reciprocal Rank Fusion. A technique for merging ranked lists from different retrieval systems (exact match + vector search) into a single ranked result.

**SymbolKind** — The type of a code symbol: `function`, `method`, `class`, `interface`, `type_alias`, `variable`, `import`, `export`, `file_summary`.

**tree-sitter** — A fast, incremental parsing library that produces concrete syntax trees for source code. Used as the parser backend.
