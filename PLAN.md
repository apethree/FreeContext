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
    mcp/            # MCP server adapter (Streamable HTTP transport, tool definitions)
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
| `id` | `string` | Stable hash-based symbol ID |
| `repoId` | `string` | Tenant/project identifier |
| `filePath` | `string` | Relative to repo root |
| `language` | `string` | `"typescript"` \| `"javascript"` |
| `symbolName` | `string` | e.g. `"SearchService"` |
| `symbolKind` | `SymbolKind` | function, method, class, interface, type_alias, variable, import, export, file_summary |
| `startLine` | `number` | 1-indexed |
| `endLine` | `number` | 1-indexed |
| `hash` | `string` | SHA-256 of rawText or full file content for `file_summary` rows (first 16 hex chars) |
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
| `id` | `string` | Stable hash-based edge ID |
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

## Phase 2: LanceDB + Full-Text + Semantic + Hybrid Retrieval

**New dependencies**: `@lancedb/lancedb`

**What to build**:
- `LanceDbStorage` — persistent on-disk storage for symbols and edges
- Full-text retrieval over indexed symbol content
- Semantic vector retrieval over stored embeddings
- Hybrid retrieval combining full-text and vector results with reciprocal rank fusion (RRF)
- Swappable `Embedder` implementations
- `OllamaEmbedder` as the default local embedding implementation
- `RemoteEmbedder` for OpenAI-compatible local or remote embedding servers
- Additional provider-backed embedders for NVIDIA Nemotron, Step 3.5 Flash, and MiniMax 2.5 through the same `Embedder` interface

**Config changes**:
- `--storage lancedb`
- `--storage-path <path>`
- `--embed`
- `--embedder ollama|openai_compatible|none`
- `--semantic`
- `--hybrid`
- `--reindex`

**Notes**:
- LanceDB is the retrieval backend, not the embedder
- The embedder remains pluggable behind the existing `Embedder` interface
- MCP work stays in Phase 4

**Verify**:
```bash
node dist/cli/index.js index ./src --storage lancedb
node dist/cli/index.js search "CodeIntelEngine" --storage lancedb
node dist/cli/index.js index ./src --storage lancedb --embed
node dist/cli/index.js search "finds functions that handle auth" --storage lancedb --semantic
```

---

## Phase 3: Graph/Edges + Incremental Indexing + Git

**What to build**:
- `EdgeExtractor` — traverses parsed symbols, emits `EdgeRow` for calls/imports/implements/extends
- Graph queries: `who_calls(symbolName)`, `what_does_this_call(symbolName)`, `codebase_map()`
- `GitChangeTracker` — wraps `git diff` to return changed file paths and current commit SHA
- Incremental indexing — compare stored `file_summary` hash vs new file hash, skip unchanged files

**Implementation notes**:
- Use deterministic symbol and edge IDs so cross-file edges are not invalidated by every re-index
- Resolve references in this order: same file, imported symbol, repo-wide exact symbol name
- Keep Phase 3 resolution intentionally simple; do not add SCIP or compiler-API dependency here

**Verify**:
```bash
node dist/cli/index.js who-calls "SearchService"
node dist/cli/index.js what-does-this-call "SearchService"
node dist/cli/index.js recently-changed --since HEAD~5
node dist/cli/index.js codebase-map
# Re-index same repo, check that unchanged files are skipped (log output)
```

---

## Phase 4: MCP Adapter + Config

**New dependencies**: `@modelcontextprotocol/sdk`

**What to build**:
- MCP server with Streamable HTTP at `/mcp`
- 10 tools:
  - `search_code(query, limit?, filePath?, pathPrefix?, kind?, mode?)` — symbol search with text, path, kind, and retrieval-mode filters
  - `search_paths(query?, pathPrefix?, limit?)` — indexed file path discovery
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

**Implementation notes**:
- Use the published `@modelcontextprotocol/sdk` package and its `McpServer` + `StreamableHTTPServerTransport` APIs
- Do not build a second application layer; MCP tool handlers should call the existing engine methods directly
- Serve a simple `/health` endpoint alongside `/mcp`
- Keep path search first-class in the public API because many repo queries are really file-discovery queries

**Verify**:
```bash
node dist/cli/index.js serve --port 3100
npx @modelcontextprotocol/inspector http://127.0.0.1:3100/mcp
# Connect, list tools, call search_code("AuthService"), verify result
```

---

## Non-goals (explicit)

- No cloud API required — all processing is local
- No React/Electron/browser dependency
- No OpenAI/Anthropic SDK — this tool is a context provider, not an LLM consumer
- No database migrations — LanceDB is schema-on-write
- No multi-language support beyond TS/JS in Phase 1-4 (Python, Go etc. deferred)
