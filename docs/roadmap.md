---
title: Roadmap
---

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

## Phase 2: Embeddings + Vector Search + LanceDB ✅

Key deliverables:
- Swappable embedders with Qwen3 as the default local option
- `LanceDbStorage` — full-text, semantic, and hybrid retrieval
- Hybrid search with RRF fusion
- CLI: `--storage lancedb --embed --semantic --hybrid`

---

## Phase 3: Graph/Edges + Incremental Indexing + Git ✅

Key deliverables:
- `EdgeExtractor` — call graph, import graph, inheritance
- Graph queries: `who_calls`, `what_does_this_call`, `codebase_map`
- `GitChangeTracker` + incremental indexing (skip unchanged files by hash)
- CLI: `who-calls`, `what-does-this-call`, `recently-changed`, `codebase-map`

---

## Phase 4: MCP Adapter + Project Config ✅

Key deliverables:
- MCP server with 10 tools over Streamable HTTP at `/mcp`
- `.free-context.json` project-local config
- CLI: `serve`, `search-paths`
- First-class path search via `search_paths` and `search --path-prefix`
- Claude Code MCP config documentation

---

## Future / Deferred

- Python, Go, Rust grammar support
- Multi-repo federation
- Cloud storage backend
- GitHub Actions integration
- VSCode extension
