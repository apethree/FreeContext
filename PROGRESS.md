# FreeContext — Progress Tracker

> Updated: 2026-03-16
> Current phase: **Complete**

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
| `cli/` | `index.ts` | CLI with `index` and `search` commands, including file/kind filters |

### Phase 1 hardening

- Fixed `npm install` on a clean checkout by aligning `tree-sitter` with the grammar peer range
- Wired `ignore` config through the indexing pipeline so custom ignore entries affect filesystem discovery
- Brought Phase 1 docs and CLI behavior into alignment around real search capabilities

### Verification

- `npm install` — passes on a clean checkout
- `npm run build` — passes
- `npm run typecheck` — passes
- `npm run test` — 34/34 tests pass (storage, parser, search, indexer, file provider, engine)

### CLI smoke test

```bash
npm run build
node dist/cli/index.js index ./src
node dist/cli/index.js search "CodeIntelEngine"
```

---

## Phase 2: LanceDB + Full-Text + Semantic + Hybrid Retrieval ✅

**Status: Done**

### What was built

- `storage/lancedb-storage.ts` — persistent LanceDB-backed symbol + edge storage
- `embeddings/ollama-embedder.ts` — default local embedding implementation
- `embeddings/remote-embedder.ts`, `embeddings/provider-embedder.ts` — OpenAI-compatible and provider-backed embedders
- Search modes: `fulltext`, `semantic`, `hybrid`
- CLI flags: `--storage`, `--storage-path`, `--embed`, `--embedder`, `--semantic`, `--hybrid`, `--reindex`

### Verification

- `npm run build` — passes
- `npm run typecheck` — passes
- `npm run test` — 45/45 tests pass at Phase 2 completion
- `node dist/cli/index.js index ./src --storage lancedb` — passes
- `node dist/cli/index.js search "CodeIntelEngine" --storage lancedb` — passes
- Verified LanceDB semantic retrieval against local and remote embedding backends
- LanceDB remains embedder-agnostic; provider selection now supports `ollama`, `openai_compatible`, `nvidia_nemotron`, `step_3_5_flash`, `minimax_2_5`, and `none`

---

## Phase 3: Graph/Edges + Incremental Indexing + Git ✅

**Status: Done**

### What was built

- `graph/edge-extractor.ts` — extracts `calls`, `imports`, `extends`, and `implements` edges after symbols are written
- `graph/graph-service.ts` — graph queries for `whoCalls`, `whatDoesThisCall`, and `codebaseMap`
- `git/git-change-tracker.ts` — git-aware changed-file and current-revision lookup
- Incremental indexing via per-file `file_summary` rows and stored file hashes
- Deterministic symbol and edge IDs so cross-file graph links survive re-indexes better than random UUIDs
- CLI commands: `who-calls`, `what-does-this-call`, `recently-changed`, `codebase-map`

### Verification

- `npm run build` — passes
- `npm run typecheck` — passes
- `npm run test` — 59/59 tests pass
- `node dist/cli/index.js index .` on a temporary TS repo — passes
- `node dist/cli/index.js who-calls audit --path .` — returns `AuthUser` and `login`
- `node dist/cli/index.js what-does-this-call login --path .` — returns `audit`
- `node dist/cli/index.js recently-changed --path . --reindex` — returns symbols from modified files
- `node dist/cli/index.js codebase-map --path .` — returns file, symbol, and edge counts

### Notes

- Incremental skipping is file-hash based, not mtime based
- Edge resolution is intentionally simple: same file, imported symbols, then repo-wide exact-name fallback
- Generated docs output (`dist-docs/`) is ignored by default so the parser does not attempt to index built site artifacts

---

## Phase 4: MCP Adapter + Config ✅

**Status: Done**

### Phase 4 hardening

- Added first-class path search across the CLI, engine, storage backends, and MCP tools
- `search` now accepts `--path-prefix` for symbol queries scoped to one directory prefix
- Added `search-paths` CLI command and `search_paths` MCP tool for indexed file discovery
- Allowed `GET /mcp` so the Streamable HTTP transport can negotiate SSE when clients request it
- Switched MCP `find_symbol` to exact symbol lookup instead of capped text prefiltering
- Added `serve --no-reindex` for quick restarts against an existing index
- Serialized LanceDB symbol and edge table initialization so concurrent upserts share one in-process create/open path
- Added `npm run mcp:smoke` as a one-command SDK smoke test for the live MCP endpoint
- Expanded the MCP docs and README with copy-paste setup for Claude Code, Cursor, Codex, Gemini CLI, and OpenCode
- Added `free-context setup-agent <client>` to print the recommended MCP stack, client-specific MCP config, and optional scout API env template
- Replaced the Promptfoo agent eval MCP wiring with custom Anthropic/OpenAI provider loops that execute FreeContext MCP tools and force a final answer before scoring
- Expanded the main agent eval from one repo question to a multi-question benchmark so raw vs `+ FreeContext` rows are easier to compare visually in Promptfoo
- Added a chunked parser fallback for large TS/JS files so indexing no longer fails at the tree-sitter direct string size limit
- Replaced repo-wide edge fallback DB lookups with an in-memory `RepoSymbolMap`
- Batched symbol and edge writes during indexing and added bulk file deletion to storage
- Added a scalar index on `symbolName` in LanceDB for exact-name lookups
- Chunked LanceDB delete predicates and skipped redundant delete/re-add work on freshly created tables to avoid cold-index crashes on larger repos
- Added `ollama` and `openai_compatible` embedders and made `ollama` the default local `--embed` path
- Removed the older ONNX embedding runtime, CLI flags, and docs so the supported embedding paths are only Ollama, OpenAI-compatible, and provider-backed backends
- Added embedding compatibility checks so semantic search and embedded reindexing fail fast on model or dimension mismatches
- Added stage-aware indexing progress for file discovery, embedding downloads, embedding batches, and write phases
- Expanded the README and reference docs with full embedding arguments, local vs remote Ollama examples, OpenAI-compatible examples, and model-switch/rebuild guidance
- Aligned the semantic eval comments and docs with the current embed-enabled local server flow
- Expanded the Promptfoo harness with OpenRouter scout raw/FreeContext rows, a no-embedding FreeContext baseline row, a new Qwen 3.5 27B web-search row, proxy-aware key handling, and semantic startup support for remote OpenAI-compatible embedding endpoints

### What was built

- `mcp/server.ts` — Streamable HTTP MCP server at `/mcp`
- 10 MCP tools: `search_code`, `search_paths`, `find_symbol`, `get_symbol`, `who_calls`, `what_does_this_call`, `list_file_symbols`, `recently_changed_symbols`, `reindex`, `codebase_map`
- `core/config-loader.ts` — `.free-context.json` project-local config loading with relative `storagePath` resolution
- `serve` CLI command
- `docs/reference/mcp-config.md` — MCP client configuration reference

### Verification

- `npm run build` — passes
- `npm run typecheck` — passes
- `npm run test` — 84/84 tests pass
- `node dist/cli/index.js serve <temp-project> --port 3210` — passes
- `curl http://127.0.0.1:3210/health` — returns `{"status":"ok",...}`
- SDK client connects to `http://127.0.0.1:3210/mcp`, lists 10 tools, and successfully calls `find_symbol`
- `oneshot-platform` parse sweep — all 276 TS/JS files parse successfully
- `oneshot-platform` full in-memory index — completes with 276 files and 8672 symbols
- `oneshot-platform` cold LanceDB index — completes after chunking large delete predicates in the storage adapter
- `oneshot-platform` MCP checks with memory storage — `search_code`, `find_symbol`, `who_calls`, `search_paths`, and `codebase_map` return repo-specific results
- `oneshot-platform` MCP checks with LanceDB storage — the same tool set returns repo-specific results against the persisted index, including 5528 stored edges

---

## Docs site (Phase 2 hardening)

- Astro Starlight site configured at root; reads `docs/**/*.md` via glob content loader — no files moved
- Added `title` frontmatter to all 11 docs pages
- `npm run docs:build` outputs to `dist-docs/`; excluded from library typecheck via tsconfig exclude
- `noImplicitAny: false` override removed from tsconfig — `strict: true` now applies fully
- `.github/workflows/docs.yml` — builds and deploys to GitHub Pages on push to `main` (paths: `docs/**`, `astro.config.mjs`, `src/content.config.ts`)

---

## Eval harness

**Status: Done**

### What was built

- `evals/tool-evals.yaml` — deterministic MCP tool evals covering the 10 current FreeContext tools
- `evals/agent-evals.yaml` — one harder cross-file effectiveness question run across four rows: Anthropic raw, OpenAI raw, Anthropic + FreeContext, and OpenAI + FreeContext
- `evals/edit-evals.yaml` — isolated real-world edit benchmark over `evals/fixtures/` with the same raw-vs-FreeContext matrix pattern
- `evals/agent-smoke.yaml` — no-MCP provider smoke eval for Anthropic, OpenAI, and OpenAI-compatible endpoints
- `evals/ollama-evals.yaml` — local scout benchmark for `ollama-raw` and `ollama-freecontext`
- `evals/providers/mcp-client.js` — custom Promptfoo provider that calls the live FreeContext MCP server through the MCP SDK
- `evals/providers/ollama-raw.js`, `ollama-freecontext.js`, `ollama-shared.js` — native Ollama `/api/chat` providers for local Qwen scout evals
- `evals/scripts/start-server.js`, `run-tool-evals.js`, `run-agent-evals.js`, `run-agent-smoke.js`, `run-semantic-evals.js`, `run-ollama-evals.js`, `run-evals.js`, `report-eval.js` — managed local server startup, env-aware eval orchestration, and saved-run telemetry summaries
- `docs/reference/evals.md` — eval usage, environment variables, and managed-server behavior
- `docs/adr/008-add-promptfoo-eval-harness.md` — Promptfoo decision record
- Provider telemetry now records token usage, model latency, tool latency, tool count, tool names, loop iterations, and MCP endpoint in saved Promptfoo JSON rows
- The isolated edit benchmark now uses a dedicated MCP server on `127.0.0.1:3212` backed by `evals/.promptfoo/edit-free-context-db` so edit tasks do not reuse the general eval index
- Tool-enabled rows now require real MCP tool use on the first round and default to natural model termination; the forced-final-answer guardrail is opt-in for debugging only
- Local Ollama scout rows now default to `qwen3.5:9b`; the earlier `qwen2.5-coder:7b` local test model was removed from the machine
- The semantic suite now stops stale managed servers before startup and allows a longer first-run embed bootstrap window for `--embed` indexing
- The managed tool and main-agent eval wrappers now bind their server on `127.0.0.1:3214` and clear `evals/.promptfoo/free-context-db` before each run so they do not reuse stale local indexes or collide with ad hoc servers on `3211`
- `GraphService` now falls back to symbol metadata when direct edge lookups are empty, which restores `what_does_this_call` and `who_calls` answers even when an older index is missing edge rows
- The OpenAI `+ FreeContext` provider now records better loop-limit diagnostics and nudges the model away from repeating identical tool calls during edit evals
- The one-question isolated edit smoke now cleanly separates raw vs `+ FreeContext`: both raw rows fail the exact-line requirement, while both tool-enabled rows pass using real MCP calls against `127.0.0.1:3212`
- The current full isolated edit benchmark shows the same pattern across all four fixture tasks: the two raw rows pass 3/8 combined, while the two `+ FreeContext` rows pass 8/8 combined using real MCP calls only
- The managed eval server startup timeout is now 3 minutes by default so cold LanceDB indexes do not fail the tool or main-agent wrappers before `/health` comes up
- The main agent benchmark now runs serially with tighter, anchor-based tracing prompts so it measures tool effectiveness more than provider TPM spikes or vague search behavior
- Provider fetch retries now default to 6 attempts with exponential backoff to reduce transient `fetch failed` noise in the paid-provider rows
- Semantic evals now reuse the repo's `.free-context/db` by default and only wipe that DB when `FREE_CONTEXT_SEMANTIC_REBUILD=1` is set; the old isolated semantic DB remains available behind `FREE_CONTEXT_SEMANTIC_ISOLATED_DB=1`
- Added a short eval quick-reference doc that lists every Promptfoo suite, the command to run it, and what each result table represents

### Verification

- `npm run eval:tool -- --no-table` — passes (10/10)
- `npx promptfoo eval -c evals/edit-evals.yaml --filter-first-n 1 --no-table -o evals/.promptfoo/edit-smoke-current.json` — completes with the isolated edit smoke; `anthropic-freecontext` and `openai-freecontext` both pass, while the raw rows both fail the exact-line rubric
- `npx promptfoo eval -c evals/edit-evals.yaml --no-table -o evals/.promptfoo/edit-current-full.json` — completes the full four-task isolated edit benchmark; total score is 11/16 with both `+ FreeContext` rows passing all four tasks
- `npm run eval:agent -- --no-table -o evals/.promptfoo/agent-current-tight.json` — completes on the tightened prompt set, but the result is still dominated by provider transport failures (`fetch failed`) in the `+ FreeContext` rows and should not yet be treated as the final effectiveness number
- `npm run eval -- --no-table` — passes tool evals and skips agent evals cleanly when no provider credentials are configured
- `npm run eval:agent:smoke` — can be used to validate provider connectivity without FreeContext MCP tool wiring
- `npx promptfoo eval -c evals/edit-evals.yaml --filter-first-n 1 --no-table -o evals/.promptfoo/edit-real-world-smoke.json` — passes for both `anthropic-freecontext` and `openai-freecontext` against the isolated MCP server on `127.0.0.1:3212`
- `npx promptfoo eval -c evals/edit-evals.yaml --no-table -o evals/.promptfoo/edit-real-world-full.json` — completes with the four-provider isolated edit benchmark and writes per-row telemetry for follow-up analysis
- `npm run eval:report -- evals/.promptfoo/edit-real-world-full.json` — prints per-row latency, token, and tool-usage summaries from the saved Promptfoo JSON
- `npm run eval:ollama -- --filter-first-n 1 --no-table -o evals/.promptfoo/ollama-smoke.json` — completes with the local `qwen3.5:9b` scout benchmark; `ollama-freecontext` now makes real MCP calls via the native Ollama `/api/chat` API, though the current benchmark question still fails for both raw and `+ FreeContext` rows
- `npm run eval:semantic -- --no-table -o evals/.promptfoo/semantic.json` — starts the dedicated semantic `--embed` server process and begins first-run bootstrap; on this machine the embed-enabled server remained CPU-bound and had not reached `/health` within the manually observed window
- `npm run typecheck` — passes
- `npm run test` — passes (100/100 tests)
- `npm run build` — passes

### Notes

- `npm run eval:agent` requires at least one configured provider: Anthropic, OpenAI, or an OpenAI-compatible endpoint
- The managed eval server defaults to `127.0.0.1:3214` and LanceDB storage under `evals/.promptfoo/`

---

## Decisions log

| Date | Decision |
|------|----------|
| 2026-03-15 | Use tree-sitter for parsing (avoids compiler API overhead, works on partial/invalid code) |
| 2026-03-15 | Phase 1 storage is in-memory only (LanceDB deferred to Phase 2) |
| 2026-03-15 | ESM-only build (matches Node 20+ direction) |
| 2026-03-15 | Embeddings deferred to Phase 2 (`@xenova/transformers` not bundled in Phase 1) |
| 2026-03-15 | Pin `tree-sitter` to the grammar peer range so clean installs pass without npm override flags |
| 2026-03-15 | Keep LanceDB storage independent from the embedding backend and make Qwen3 the default embedder implementation |
| 2026-03-15 | Use deterministic symbol and edge IDs plus generated `file_summary` rows so incremental indexing and graph edges can coexist |
| 2026-03-15 | Use Streamable HTTP at `/mcp` via the published MCP SDK instead of reviving server-side SSE |
| 2026-03-15 | Resolve repo-wide edge fallbacks from an in-memory exact-name map and batch LanceDB writes instead of doing per-reference database lookups |
