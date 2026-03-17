# FreeContext

> A host-agnostic TypeScript code intelligence engine that indexes your codebase into searchable, symbol-centric records — exposable to any AI agent via MCP.

---

## What it does

FreeContext parses TypeScript and JavaScript codebases using tree-sitter, extracts a structured symbol index (functions, classes, interfaces, imports, exports, and call sites), and makes that index queryable by name, file, or symbol kind in Phase 1.

The index is exposed as an **MCP (Model Context Protocol) server** over Streamable HTTP, giving AI agents like Claude Code and Codex structured, low-hallucination access to your codebase without raw file dumps.

---

## Quickstart

```bash
# Install
npm install -g free-context
# or use npx: npx free-context <command>

# Index your project
free-context index ./my-project

# Search symbols
free-context search "AuthService"

# Search file paths
free-context search-paths auth

# List symbols in a file
free-context search --file src/auth/service.ts

# Find classes in a file
free-context search --file src/auth/service.ts --kind class

# Find callers for a symbol
free-context who-calls AuthService

# Start the MCP server
free-context serve ./my-project --port 3100

# Start with local embeddings via Ollama
free-context serve ./my-project --storage lancedb --embed

# Smoke-test the MCP endpoint with the SDK client
npm run mcp:smoke
```

When `--embed` is enabled, FreeContext defaults to the local `ollama` backend with `qwen3-embedding:0.6b`.

## Embedding Setup

### Default local Ollama flow

```bash
# One-time model pull
ollama pull qwen3-embedding:0.6b

# Index with persistent storage and local embeddings
free-context index . --storage lancedb --embed

# Or start the MCP server with embeddings enabled
free-context serve . --storage lancedb --embed
```

Default behavior when `--embed` is set with no explicit embedder:

- embedder: `ollama`
- model: `qwen3-embedding:0.6b`
- host: `http://127.0.0.1:11434`

### Remote Ollama host

```bash
free-context serve . \
  --storage lancedb \
  --embed \
  --embedder ollama \
  --embedding-base-url http://10.0.0.20:11434
```

You can also set:

```bash
export OLLAMA_HOST=http://10.0.0.20:11434
export OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

### Change the embedding model

```bash
free-context index . \
  --storage lancedb \
  --embed \
  --embedder ollama \
  --embedding-model-id qwen3-embedding:8b \
  --embedding-dimensions 4096
```

If you switch models or dimensions, rebuild the index. FreeContext now fails fast instead of mixing incompatible vectors in one LanceDB index.

### OpenAI-compatible local or remote server

```bash
free-context serve . \
  --storage lancedb \
  --embed \
  --embedder openai_compatible \
  --embedding-base-url http://127.0.0.1:8080/v1 \
  --embedding-model-id text-embedding-qwen
```

Optional environment variables:

```bash
export OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8080/v1
export OPENAI_COMPATIBLE_MODEL=text-embedding-qwen
export OPENAI_COMPATIBLE_API_KEY=...
```

---

## Use With Coding Agents

Start FreeContext once for the repo you want to expose:

```bash
free-context serve . --storage lancedb --port 3100
```

Then connect your coding agent to:

```text
http://127.0.0.1:3100/mcp
```

Or generate the setup instructions for a specific client with one command:

```bash
free-context setup-agent claude-code
free-context setup-agent codex --scout-provider openrouter
```

Recommended instruction snippet for any agent config or project rules file:

```text
Use the free-context MCP server for symbol lookup, path search, call graph queries, and codebase summaries before falling back to raw file search.
```

### Claude Code

```bash
claude mcp add --transport http --scope user free-context http://127.0.0.1:3100/mcp
```

Verify inside Claude Code with `/mcp`.

### Cursor

Add this to `~/.cursor/mcp.json` or `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "free-context": {
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

### Codex

```bash
codex mcp add free-context --url http://127.0.0.1:3100/mcp
codex mcp list
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.free-context]
url = "http://127.0.0.1:3100/mcp"
```

### Gemini CLI

Add this to `~/.gemini/settings.json` or `.gemini/settings.json` in your project:

```json
{
  "mcpServers": {
    "free-context": {
      "httpUrl": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

### OpenCode

Add this to `~/.config/opencode/opencode.json` or `opencode.json` in your project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "free-context": {
      "type": "remote",
      "url": "http://127.0.0.1:3100/mcp",
      "enabled": true
    }
  }
}
```

### Typical prompts

- `Use free-context to find who calls dispatchPlugin.`
- `Use free-context search_paths to show everything under apps/gateway/src.`
- `Use free-context codebase_map and summarize the repo structure.`
- `Use free-context find_symbol for AuthService before editing anything.`

### Recommended MCP stack

Keep the stack small:

- `free-context`: local symbol, path, graph, and codebase retrieval
- `context7`: current framework and library docs
- `playwright`: browser automation and UI verification
- `github`: optional for PRs, issues, and repo-hosting workflow
- `web-search`: optional if your client does not already include a strong built-in web tool

Do not add a separate shell-execution MCP if your client already has native shell/file tools. Use the client’s built-in shell for tests, git, ripgrep, and edits.

### Scout models

Use a cheap scout model for:

- context packet assembly
- test-log triage
- broad repo scouting
- summarization over FreeContext tool results

`free-context setup-agent <client> --scout-provider <provider>` prints a simple env template for that provider.

---

## Installation (from source)

```bash
git clone https://github.com/apethree/FreeContext.git
cd FreeContext
npm install
npm run build
```

---

## Current Phase

**All Planned Phases Complete**

The engine can parse TypeScript/JavaScript, persist symbols in memory or LanceDB, run full-text, semantic, hybrid, and path retrieval, build call/import/inheritance edges, skip unchanged files during re-index, and expose all of that through an MCP server at `/mcp`. See [PROGRESS.md](./PROGRESS.md) for the exact verification status.

Semantic indexing and search fail fast if the active embedding model or vector dimensions do not match the existing LanceDB index. Rebuild the index when you switch embedding models.

---

## Supported languages

| Language       | Extensions          | Status |
|---------------|---------------------|--------|
| TypeScript    | `.ts`               | ✅ Phase 1 |
| TypeScript JSX | `.tsx`             | ✅ Phase 1 |
| JavaScript    | `.js`               | ✅ Phase 1 |
| JavaScript JSX | `.jsx`             | ✅ Phase 1 |

---

## Architecture overview

See [docs/architecture/overview.md](./docs/architecture/overview.md) for the full system design.

```
FileProvider → Parser → Indexer → IndexStorage
                                       ↓
                                  SearchService
                                       ↓
                           CodeIntelEngine (public façade)
                                       ↓
                              CLI   /   MCP Server
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/architecture/overview.md](./docs/architecture/overview.md) | System design and data flow |
| [docs/architecture/data-model.md](./docs/architecture/data-model.md) | `CodeSymbolRow`, `EdgeRow` schema |
| [docs/adr/](./docs/adr/) | Architecture decision records |
| [docs/how-to/index-a-project.md](./docs/how-to/index-a-project.md) | Step-by-step indexing guide |
| [docs/reference/cli.md](./docs/reference/cli.md) | CLI reference |
| [docs/reference/config.md](./docs/reference/config.md) | Config schema |
| [docs/reference/mcp-config.md](./docs/reference/mcp-config.md) | MCP server and client config |
| [docs/reference/mcp-config.md#client-setups](./docs/reference/mcp-config.md#client-setups) | Copy-paste MCP setup for popular coding agents |
| [docs/roadmap.md](./docs/roadmap.md) | Phase roadmap |
| [PLAN.md](./PLAN.md) | Detailed implementation plan |
| [PROGRESS.md](./PROGRESS.md) | Phase-by-phase progress tracker |

---

## Contributing

Read [AGENTS.md](./AGENTS.md) for how to work with this repo using AI agents. Before opening a PR, run:

```bash
npm run typecheck
npm run test
npm run build
```

---

## License

MIT
