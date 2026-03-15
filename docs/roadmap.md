# Roadmap

---

## Phase 1: Core + Parser + Storage + CLI ✅

Done. See [PROGRESS.md](../PROGRESS.md).

Key deliverables:
- tree-sitter parser for TS/TSX/JS/JSX
- In-memory symbol store
- Exact text/file/kind search
- CLI: `index`, `search`
- 28 passing tests

---

## Phase 2: Embeddings + Vector Search + LanceDB

Key deliverables:
- `LocalEmbedder` — sentence-transformer model via `@xenova/transformers` (no API key)
- `LanceDbStorage` — on-disk vector index
- Hybrid search with RRF fusion
- CLI: `--storage lancedb --embed`

---

## Phase 3: Graph/Edges + Incremental Indexing + Git

Key deliverables:
- `EdgeExtractor` — call graph, import graph, inheritance
- Graph queries: `who_calls`, `what_does_this_call`, `codebase_map`
- `GitChangeTracker` + incremental indexing (skip unchanged files by hash)
- CLI: `who-calls`, `recently-changed`

---

## Phase 4: MCP Adapter + Project Config

Key deliverables:
- MCP server with 9 tools
- `.free-context.json` project-local config
- CLI: `serve`
- Claude Code MCP config documentation

---

## Future / Deferred

- Python, Go, Rust grammar support
- Multi-repo federation
- Cloud storage backend
- GitHub Actions integration
- VSCode extension
