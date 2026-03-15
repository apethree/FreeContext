# FreeContext — Implementation Plan

> This document is the canonical implementation plan. PROGRESS.md tracks execution state. Update both together.

---

## Goal

Build a host-agnostic TypeScript code intelligence engine that:

1. Indexes TypeScript/JavaScript codebases into symbol-centric records
2. Supports exact + semantic (vector) search
3. Tracks call graphs and import graphs
4. Exposes everything through an MCP server for Claude Code, Codex, and any MCP-compatible client
5. Runs without internet access (local embeddings, local vector store)

---

## Package scope

Standalone Node.js library + CLI. No React, no Electron, no cloud dependencies.

Importable as:

```ts
import { CodeIntelEngine } from "free-context";
```

Or invoked as CLI:

```bash
free-context index ./src
free-context search "AuthService"
free-context serve --port 3100
```

---

## Repo layout

```
FreeContext/
  src/
    types/          # Shared interfaces, data types, config
    storage/        # IndexStorage interface + MemoryStorage + LanceDbStorage
    parser/         # tree-sitter TS/JS parser, symbol builder, hashing
    indexer/        # Indexing pipeline + NodeFileProvider
    search/         # SearchService, ranking, hybrid retrieval
    graph/          # EdgeExtractor + graph queries (who_calls, etc.)
    git/            # GitChangeTracker (git diff integration)
    embeddings/     # Embedder interface + NoopEmbedder + LocalEmbedder
    core/           # CodeIntelEngine (public façade), config loading
    mcp/            # MCP server adapter (SSE transport, tool definitions)
    cli/            # CLI entrypoint
    __tests__/      # Tests by module
  docs/
    architecture/   # System design, component docs
    adr/            # Architecture decision records
    how-to/         # Task-based guides
    reference/      # CLI, config, API, schema reference
    roadmap.md
    glossary.md
  package.json
  tsconfig.json
  tsconfig.build.json
  tsup.config.ts
  vitest.config.ts
  README.md
  PROGRESS.md
  PLAN.md
  AGENTS.md
```

---

## Key interfaces

```ts
// Who provides files
interface FileProvider {
  listFiles(root: string, extensions?: string[]): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ mtimeMs: number } | null>;
}

// Who parses source into symbols
interface LanguageParser {
  readonly supportedExtensions: string[];
  readonly parserVersion: string;
  parseFile(filePath: string, content: string): ParsedSymbol[];
}

// Who produces embeddings
interface Embedder {
  embedTexts(texts: string[]): Promise<number[][]>;
  readonly modelId: string;
  readonly dimensions: number;
}

// Where symbols are stored + queried
interface IndexStorage {
  upsertSymbols(symbols: CodeSymbolRow[]): Promise<void>;
  upsertEdges(edges: EdgeRow[]): Promise<void>;
  searchSymbols(query: SymbolSearchQuery): Promise<CodeSymbolRow[]>;
  getSymbolById(id: string): Promise<CodeSymbolRow | null>;
  getSymbolsByFile(repoId: string, filePath: string): Promise<CodeSymbolRow[]>;
  getEdgesFrom(symbolId: string): Promise<EdgeRow[]>;
  getEdgesTo(symbolId: string): Promise<EdgeRow[]>;
  deleteSymbolsByFile(repoId: string, filePath: string): Promise<void>;
}
```

---

## Data model

### CodeSymbolRow

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID |
| `repoId` | `string` | Tenant/project identifier |
| `filePath` | `string` | Relative to repo root |
| `language` | `string` | `"typescript"` \| `"javascript"` |
| `symbolName` | `string` | e.g. `"SearchService"` |
| `symbolKind` | `SymbolKind` | function, method, class, interface, type_alias, variable, import, export, file_summary |
| `startLine` | `number` | 1-indexed |
| `endLine` | `number` | 1-indexed |
| `hash` | `string` | SHA-256 of rawText (first 16 hex chars) |
| `parserVersion` | `string` | Semver |
| `embeddingModelId` | `string \| null` | |
| `rawText` | `string` | Source text of the symbol |
| `imports` | `string[]` | Module specifiers imported by this symbol |
| `exports` | `string[]` | Names exported by this symbol |
| `calls` | `string[]` | Call expressions within this symbol |
| `isTest` | `boolean` | |
| `tags` | `string[]` | |
| `modifiedAt` | `number` | Unix ms |
| `gitCommit` | `string \| null` | |
| `embedding` | `number[] \| null` | |

### EdgeRow

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | UUID |
| `repoId` | `string` | |
| `fromSymbolId` | `string` | |
| `toSymbolId` | `string` | |
| `edgeKind` | `EdgeKind` | calls, imports, implements, extends |
| `filePath` | `string` | |

---

## Phase 1: Core + Parser + Storage + CLI

**Dependencies**: `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript`, `glob`, `commander`, `zod`

**What to build**:
- All `types/` interfaces
- `MemoryStorage` implementation
- `TreeSitterParser` for TS/TSX/JS/JSX
- `contentHash` utility
- `NoopEmbedder`
- `NodeFileProvider`
- `Indexer` pipeline
- `SearchService` (exact text/file/kind)
- `CodeIntelEngine` public façade
- CLI with `index` + `search` commands

**Tests**: parser, storage, search, engine (integration)

**Verify**:
```bash
npm run build
npm run typecheck
npm run test
node dist/cli/index.js index ./src
node dist/cli/index.js search "CodeIntelEngine"
```

---

## Phase 2: Embeddings + Vector Search + LanceDB

**New dependencies**: `@xenova/transformers`, `@lancedb/lancedb`, `apache-arrow`

**What to build**:
- `LocalEmbedder` — runs a small sentence-transformer model locally via `@xenova/transformers`
- `LanceDbStorage` — LanceDB vector table with HNSW index
- Hybrid search: exact name match + vector cosine, fused with reciprocal rank fusion (RRF)

**Config changes**: `--storage lancedb`, `--embed` flags in CLI

**Verify**:
```bash
node dist/cli/index.js index ./src --storage lancedb --embed
node dist/cli/index.js search "finds functions that handle auth" --semantic
# Returns semantically relevant results even with no exact name match
```

---

## Phase 3: Graph/Edges + Incremental Indexing + Git

**What to build**:
- `EdgeExtractor` — traverses parsed symbols, emits `EdgeRow` for calls/imports/implements/extends
- Graph queries: `who_calls(symbolName)`, `what_does_this_call(symbolName)`, `codebase_map()`
- `GitChangeTracker` — wraps `git diff` to return changed file paths and current commit SHA
- Incremental indexing — compare stored hash vs new hash, skip unchanged files

**Verify**:
```bash
node dist/cli/index.js who-calls "SearchService"
node dist/cli/index.js recently-changed --since HEAD~5
# Re-index same repo, check that unchanged files are skipped (log output)
```

---

## Phase 4: MCP Adapter + Config

**New dependencies**: `@modelcontextprotocol/sdk`

**What to build**:
- MCP server with SSE transport at `/sse`
- 9 tools:
  - `search_code(query, limit?)` — hybrid text+vector search
  - `find_symbol(name, kind?)` — exact symbol lookup
  - `get_symbol(id)` — fetch one symbol by ID
  - `who_calls(symbolName)` — graph: callers
  - `what_does_this_call(symbolName)` — graph: callees
  - `list_file_symbols(filePath)` — all symbols in a file
  - `recently_changed_symbols(since?)` — git-aware
  - `reindex()` — trigger incremental re-index
  - `codebase_map()` — high-level summary of the codebase
- `.free-context.json` project-local config
- `serve` CLI command
- Claude Code MCP config template at `docs/reference/mcp-config.md`

**Verify**:
```bash
node dist/cli/index.js serve --port 3100
npx @modelcontextprotocol/inspector http://localhost:3100
# Connect, list tools, call search_code("AuthService"), verify result
```

---

## Non-goals (explicit)

- No cloud API required — all processing is local
- No React/Electron/browser dependency
- No OpenAI/Anthropic SDK — this tool is a context provider, not an LLM consumer
- No database migrations — LanceDB is schema-on-write
- No multi-language support beyond TS/JS in Phase 1-4 (Python, Go etc. deferred)
