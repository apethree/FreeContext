# FreeContext — Progress Tracker

> Updated: 2026-03-15
> Current phase: **Phase 1 — Complete**

---

## Phase 1: Core + Parser + Storage + CLI ✅

**Status: Done**

### What was built

| Module | Files | Notes |
|--------|-------|-------|
| `types/` | `index.ts` | All shared interfaces and data types |
| `storage/` | `memory-storage.ts` | In-memory `IndexStorage` — text/file/kind search, upsert, delete |
| `parser/` | `ts-parser.ts`, `hash.ts` | tree-sitter parser for TS/TSX/JS/JSX — extracts functions, methods, classes, interfaces, type aliases, variables, imports, exports, call expressions |
| `embeddings/` | `noop-embedder.ts` | No-op embedder (placeholder for Phase 2) |
| `indexer/` | `indexer.ts`, `node-file-provider.ts` | Full indexing pipeline: list → parse → hash → embed → store |
| `search/` | `search-service.ts` | Exact name/file/kind search |
| `core/` | `engine.ts` | `CodeIntelEngine` public façade |
| `cli/` | `index.ts` | CLI with `index` and `search` commands |

### Verification

- `npm run build` — passes
- `npm run typecheck` — passes
- `npm run test` — 28/28 tests pass (storage, parser, search, engine)

### CLI smoke test

```bash
npm run build
node dist/cli/index.js index ./src
node dist/cli/index.js search "CodeIntelEngine"
```

---

## Phase 2: Embeddings + Vector Search + LanceDB 🔲

**Status: Not started**

### What will be built

- `LocalEmbedder` via `@xenova/transformers` (runs locally, no API key)
- `LanceDbStorage` with on-disk vector index
- Hybrid search: exact match + vector cosine + reciprocal rank fusion

### Verification target

```bash
node dist/cli/index.js index ./src --storage lancedb --embed
node dist/cli/index.js search "finds all callers" --semantic
```

---

## Phase 3: Graph/Edges + Incremental Indexing + Git 🔲

**Status: Not started**

### What will be built

- `EdgeExtractor` — populate `EdgeRow` (calls, imports, implements, extends)
- Graph queries: `who_calls`, `what_does_this_call`, `codebase_map`
- `GitChangeTracker` — git diff integration, `recently_changed_symbols`
- Incremental indexing — skip unchanged files by hash comparison

### Verification target

```bash
node dist/cli/index.js who-calls "SearchService"
node dist/cli/index.js recently-changed --since HEAD~5
```

---

## Phase 4: MCP Adapter + Config 🔲

**Status: Not started**

### What will be built

- MCP server with SSE transport
- 9 MCP tools: `search_code`, `find_symbol`, `get_symbol`, `who_calls`, `what_does_this_call`, `list_file_symbols`, `recently_changed_symbols`, `reindex`, `codebase_map`
- `.free-context.json` project-local config
- `serve` CLI command
- Claude Code MCP config

### Verification target

```bash
node dist/cli/index.js serve --port 3100
# MCP inspector connects, lists tools, returns correct results
```

---

## Decisions log

| Date | Decision |
|------|----------|
| 2026-03-15 | Use tree-sitter for parsing (avoids compiler API overhead, works on partial/invalid code) |
| 2026-03-15 | Phase 1 storage is in-memory only (LanceDB deferred to Phase 2) |
| 2026-03-15 | ESM-only build (matches Node 20+ direction) |
| 2026-03-15 | Embeddings deferred to Phase 2 (`@xenova/transformers` not bundled in Phase 1) |
