# FreeContext — Progress Tracker

> Updated: 2026-03-18
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
- Added an embed-enabled MCP smoke suite so all MCP tools are exercised once against an embed-enabled server, separate from the narrower semantic/hybrid smoke
- Semantic and embed-smoke eval startup now forwards remote embedding model and dimension overrides, and the OpenAI-compatible embedder now shrinks oversized single inputs instead of aborting the full index
- Default file discovery now ignores `evals/workspaces` so local benchmark fixtures do not contaminate FreeContext self-indexing or semantic eval results

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
- `evals/tool-fulltext-evals.yaml` — deterministic fulltext-only retrieval checks independent of any agent provider
- `evals/agent-evals.yaml` — primary SDK-backed coding-agent benchmark with base, direct-FreeContext, and scout-bridge tiers where scout rows now follow the unrestricted dual-access strategy: both scout and main keep default tools plus FreeContext
- `evals/agent-scout-matrix-evals.yaml` — scout-comparison benchmark that swaps multiple scout models in front of the same final Claude or Codex agent
- `evals/agent-embedding-evals.yaml` — embedding-focused agent benchmark for the active FreeContext-enabled and scout-bridge rows
- `evals/agent-hybrid-evals.yaml` — hybrid-focused agent benchmark for the active FreeContext-enabled and scout-bridge rows
- `evals/agent-semantic-evals.yaml` — legacy alias retained for compatibility; the active retrieval-focused agent suites are now `agent-embedding-evals.yaml` and `agent-hybrid-evals.yaml`
- `evals/edit-evals.yaml` — isolated SDK-backed edit benchmark over staged fixture files using the same staged-workspace sandbox strategy as the main agent suite
- `evals/semantic-tool-evals.yaml` — legacy mixed retrieval alias retained for compatibility; the active retrieval suites are now `tool-embedding-evals.yaml` and `tool-hybrid-evals.yaml`
- `evals/tool-embedding-evals.yaml` — deterministic embedding-only retrieval checks independent of any agent provider
- `evals/tool-hybrid-evals.yaml` — deterministic hybrid retrieval checks independent of any agent provider
- `evals/tool-embed-smoke-evals.yaml` — embed-enabled MCP smoke
- `evals/providers/mcp-client.js` — custom Promptfoo provider that calls the live FreeContext MCP server through the MCP SDK
- `evals/providers/native-agent-shared.js` — shared Claude-agent and Codex-agent SDK integration used by the active benchmark providers
- `evals/providers/anthropic-default-tools.js`, `anthropic-freecontext.js`, `openai-default-tools.js`, `openai-freecontext.js`, `scout-provider.js`, `qwen-scout-shared.js`, and the `edit-*` providers — active SDK-native benchmark providers
- `evals/providers/scout-models.js` — scout preset registry for OpenRouter-backed and local-llama scout models
- `evals/providers/provider-labels.js` — shared model-derived Promptfoo row labels so the UI reflects the actual Anthropic/OpenAI/scout model IDs in use
- `evals/providers/braintrust-shared.js` — Braintrust trace helpers for eval-case, scout-phase, main-phase, and per-tool spans
- `evals/scripts/agent-variant-matrix.js` — shared active 3-tier strategy matrix used by both Promptfoo and Braintrust-native agent runners
- `evals/scripts/braintrust-case-loader.js` — loads the active Promptfoo YAML suites into repo-local Braintrust dataset rows with shared `expected` targets and deterministic check metadata
- `evals/scripts/braintrust-scorers.js` — strict code-based and local LLM-based Braintrust scorers
- `evals/scripts/braintrust-agent-runner.js`, `run-braintrust-agent-evals.js`, `run-braintrust-agent-embedding-evals.js`, and `run-braintrust-agent-hybrid-evals.js` — Braintrust-native non-semantic, embedding, and hybrid experiment runners
- `evals/scripts/load-local-env.js` — repo-local env loading plus proxy env normalization for evals
- `evals/scripts/prepare-workspace.js` — staged workspace reset for agent and edit suites
- `evals/scripts/promptfoo-provider-filter.js` — pre-filters repeated custom JS provider blocks into temporary Promptfoo configs so exact provider/scout targeting works reliably
- `evals/scripts/eval-control-shared.js`, `run-eval-control-ui.js`, and `evals/ui/` — local eval control server and static UI for direct-vs-proxy base-model routing, scout routing, exact suite launch, and recent run logs
- `evals/scripts/start-server.js`, `run-tool-evals.js`, `run-agent-evals.js`, `run-agent-embedding-evals.js`, `run-agent-hybrid-evals.js`, `run-agent-smoke.js`, `run-edit-evals.js`, `run-edit-smoke.js`, `run-semantic-evals.js`, `run-semantic-smoke.js`, `run-evals.js`, and `report-eval.js` — managed local server startup, workspace staging, eval orchestration, and saved-run telemetry summaries
- `docs/reference/evals.md` — active eval usage, proxy environment variables, and managed-server behavior
- `docs/reference/eval-quick-reference.md` — short command and table guide
- `docs/adr/008-add-promptfoo-eval-harness.md` — Promptfoo decision record
- `docs/adr/010-use-sdk-native-coding-agent-benchmarks.md` — SDK-native benchmark decision record
- Promptfoo telemetry records token usage, cost, retrieval mode, local-tool counts, MCP-tool counts, scout MCP counts, changed paths, workspace root, and MCP endpoint
- Active suites keep Promptfoo result caching disabled while preserving provider-side prompt caching, and `eval:report` now splits fresh prompt tokens, cache read/write tokens, effective input surface, and main-vs-scout tool counts
- When `BRAINTRUST_API_KEY` is present, active providers emit Braintrust spans for `eval_case`, `scout_phase`, `main_phase`, and every `freecontext_mcp_call`, including exact FreeContext args so embedding vs fulltext vs hybrid usage is explicit
- Braintrust FreeContext spans now include a compact result preview for Claude-agent and scout rows, so tool returns are visible alongside the MCP args
- Braintrust phase spans now include prompt/completion/cache token totals, effective input, and estimated cost; scout-bridge root spans also record separate `scout*` and `main*` token and cost totals
- Braintrust root traces now include clearer strategy tags (`strategy:baseline`, `strategy:direct-freecontext`, `strategy:scout-bridge-freecontext`) plus benchmark `expected` values from the active test cases, so trace-level `Correctness` or `Completeness` scorers can compare `output` vs `expected` directly in Braintrust
- Braintrust-native experiments now reuse the active Promptfoo YAML suites as the single source of truth for cases and `expected` targets, so Promptfoo and Braintrust score the same tasks instead of maintaining two answer-key copies
- Braintrust-native runs now record final-output score names that are explicit about scope: strict code-based (`FinalAnswerStrictPass`, `FinalAnswerStrictFraction`) and local LLM-based (`FinalAnswerCorrectness`, `FinalAnswerCompleteness`)
- Braintrust-native experiment rows now also include clearer row metadata such as `variantDisplayName`, `strategyLabel`, `mainModel`, and `retrievalLabel`, and experiment names now summarize the suite, provider group, selected strategy, selected case, and timestamp
- Braintrust-native runs write local summary artifacts under `evals/.braintrust/`, and `eval:report` now reads both Promptfoo and Braintrust-native JSON summaries
- The active suites use proxy-backed defaults from `PROXY_API` and `PROXY_TOKEN`
- Default benchmark models are `claude-haiku-4-5-20251001` and `gpt-5-codex-mini`
- Active Promptfoo row labels are now model-derived (`anthropic-<model>-...`, `openai-<model>-...`) instead of hardcoded `claude-*` / `codex-*`, so the UI stays accurate when eval model defaults change
- Clarified the eval docs so `eval:agent:smoke` is documented as a preset wrapper, while exact row control examples now use `eval:agent` with explicit `--filter-targets` and `--filter-pattern`
- Fixed exact provider/scout filtering by moving agent/edit/scout/semantic provider selection into the repo runners instead of relying on Promptfoo to match repeated custom JS providers by runtime label
- Revalidated exact OpenAI base-row filtering with `npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$' --filter-pattern 'trace path search to the gateway plugin registry area'`, which now executes one selected provider row instead of returning `0/0`
- Added explicit docs for the two common exact-run workflows: all tests for one provider row, and all tests for all base providers
- Corrected the shell examples for exact `+freecontext` target filters to use a single regex escape (`\+`) inside single quotes, so they can be pasted directly into zsh/bash
- Added a local eval control UI so provider routing, scout routing, and exact suite execution can be managed without hand-editing shell env vars
- Redesigned the local eval control UI around a clickable row matrix, conditional proxy-vs-direct field groups, and a clearer split between remote scout presets and OpenAI-compatible scout endpoints
- Simplified the eval control UI from a landing-page style layout into a practical dashboard and added `Load env defaults` so proxy URLs, tokens, scout keys, and direct-provider defaults can be reloaded from the environment on demand
- Adjusted the eval control UI so API keys remain visible, the OpenAI base-model tab switches correctly, and OpenAI-compatible scout mode reuses the same scout preset choices as the remote preset path
- Reworked the eval control settings into row-based provider and scout tables, and changed the OpenAI-compatible scout endpoint defaults to preload the active Quotio proxy URL and token when available
- Split the eval control UI into separate `Routing` and `Run eval` tabs so routing can be saved once and the normal workflow stays centered on the run matrix
- Fixed the eval control UI recent-runs auto-refresh so scrolling through logs no longer snaps back to the top on each poll
- Scout-bridge rows use a read-only Qwen 27B scout (`qwen/qwen3.5-27b`) for discovery before handing evidence to the final Claude or Codex agent
- Scout presets now also support `minimax/minimax-m2.5`, `stepfun/step-3.5-flash`, `x-ai/grok-4.1-fast`, `nvidia/nemotron-3-super-120b-a12b`, and a local OpenAI-compatible llama endpoint
- The local scout path now has a generic `openai-compatible` preset alias in addition to `local-llama`, so any OpenAI-compatible scout endpoint can be swapped in without changing provider code
- The active main, embedding, and hybrid agent benchmarks now use the unrestricted 3-tier strategy: `default-tools`, `default-tools+freecontext`, and `scout+default-tools+freecontext`
- Added `npm run eval:agent:scouts:smoke` so a single scout preset can be smoke-tested cheaply before running the full scout matrix
- Scout loops now default to 12 tool turns and force a final evidence-summary turn after the cap instead of failing the run on max-turn exhaustion
- All agent and edit evals run against staged workspaces; only staged copies may be edited, and scout rows stay read-only during discovery
- The fixed fixture source stays immutable and index-free; disposable staged workspaces are rebuilt from it for each run, while LanceDB state stays under `.free-context/` or `evals/.promptfoo/*-db`
- Promptfoo rubric grading is pinned to the same Claude Haiku proxy path so agent evals do not fall back to Promptfoo's unsupported built-in OpenAI grader default
- Removed legacy Promptfoo suites and providers for no-tools baselines, OpenRouter-only scouting, Ollama scout rows, and the web-search benchmark so the repo only keeps the active SDK-native benchmark paths
- Semantic evals now reuse `.free-context/db` by default, with `FREE_CONTEXT_SEMANTIC_ISOLATED_DB=1` available for isolated rebuilds
- Split the old mixed retrieval tool suite into separate embedding-only and hybrid-only runs, while keeping the older `eval:semantic` commands as compatibility aliases to the embedding path
- Added a dedicated fulltext-only retrieval suite so run selection is now split cleanly across `Tool core`, `Tool fulltext`, `Tool embedding`, `Tool hybrid`, and `Embed-enabled health`
- Split the old combined agent retrieval benchmark into separate `Agent embedding` and `Agent hybrid` runs, while keeping the older `eval:agent:semantic` and `eval:braintrust:agent:semantic` commands as compatibility aliases to the embedding path

### Verification

- `npm run build` — passes after the SDK-native benchmark migration
- `npm run typecheck` — passes
- `npm run test` — passes (103/103 after the proxy-backed SDK cleanup)
- `npm run eval:tool -- --no-table -o evals/.promptfoo/tool-current.json` — passes (10/10) on the staged fixture workspace
- `npm run eval:agent:smoke -- --group anthropic --no-table -o evals/.promptfoo/agent-sdk-smoke-anthropic-proxy.json` — completes against the proxy-backed Claude SDK path; current smoke is `1/2` with the `+ FreeContext` row passing
- `npm run eval:agent:smoke -- --group openai --no-table -o evals/.promptfoo/agent-sdk-smoke-openai-proxy.json` — completes against the proxy-backed Codex SDK path; current smoke is `2/2`
- `npm run eval:report -- evals/.promptfoo/tool-current.json` — prints per-row latency, token, cost, and tool-usage summaries from the saved Promptfoo JSON
- `npm run build`, `npm run typecheck`, and `npm run test` — pass after adding phase-level Braintrust token or cost metadata and scout-vs-main token reporting
- `npm run build`, `npm run typecheck`, and `npm run test` — pass after adding Braintrust eval tracing and the staged-workspace documentation updates
- `npm run build`, `npm run typecheck`, and `npm run test` — pass after adding Braintrust-native experiment runners, strict plus LLM scorers, the shared variant matrix, and local `.braintrust/` summary artifacts (117/117 tests pass)
- `npm run eval:braintrust:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools$' --filter-pattern 'trace path search to the gateway plugin registry area'` — completes a live Braintrust-native smoke run and records `StrictPass`, `StrictFraction`, `LLMCorrectness`, and `LLMCompleteness`
- `npm run eval:agent:smoke -- --group anthropic --filter-targets '^claude-default-tools\\+freecontext$' --no-table -o evals/.promptfoo/claude-freecontext-repro.json` — reran the reported empty-output row; the repro passed, so the empty answer appears intermittent rather than a deterministic MCP failure
- `npm run eval:agent -- --group openai --filter-pattern 'trace path search to the gateway plugin registry area' --filter-targets '^(codex-default-tools\\+freecontext|codex-scout-qwen27b\\+default-tools\\+freecontext)$' --no-table -o evals/.promptfoo/agent-scout-bridge-openai-clean.json` — completes the direct-vs-scout bridge comparison on the proxy-backed Codex path without provider or MCP transport errors
- `npm run eval:agent -- --group anthropic --filter-pattern 'trace path search to the gateway plugin registry area' --filter-targets '^(claude-default-tools\\+freecontext|claude-scout-qwen27b\\+default-tools\\+freecontext)$' --no-table -o evals/.promptfoo/agent-scout-bridge-anthropic-clean.json` — completes the direct-vs-scout bridge comparison on the proxy-backed Claude path; the direct `+ FreeContext` row currently passes and the scout row completes with real scout MCP usage but still misses one content assertion
- Agent and edit smoke or full runs require valid provider credentials through `PROXY_API` and `PROXY_TOKEN`, or direct `ANTHROPIC_*` / `OPENAI_*` credentials

### Notes

- `npm run eval:agent` requires at least one configured provider through `PROXY_API` and `PROXY_TOKEN`, or direct `ANTHROPIC_*` / `OPENAI_*` credentials
- The managed eval server defaults to `127.0.0.1:3214` and LanceDB storage under `evals/.promptfoo/`
- Scout rows are explicit model-derived `*-scout-<scout-model>-default-tools` and `*-scout-<scout-model>-default-tools+freecontext` tiers. The scout is read-only and discovery-only; the final coding agent still owns the final answer or edit.

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
