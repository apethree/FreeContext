---
title: CLI Reference
---

# CLI Reference

```
free-context <command> [options]
```

---

## Commands

### `index`

Parse and index a codebase into the symbol store.

```bash
free-context index [path] [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `path` | `.` | Root directory to index |
| `--repo-id <id>` | stable hash of root path | Stable identifier for this project |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--embed` | off | Generate embeddings during indexing |
| `--embedder <name>` | `none` | `none`, `ollama`, `openai_compatible`, `nvidia_nemotron`, `step_3_5_flash`, or `minimax_2_5` |
| `--embedding-model-id <id>` | embedder default | Override the embedding model name |
| `--embedding-base-url <url>` | unset | Base URL for `ollama` or `openai_compatible` |
| `--embedding-dimensions <n>` | embedder default | Embedding dimensions override |

Output format:
```
Indexed 42 files, skipped 18, wrote 913 symbols
```

When embeddings are enabled, the indexer now prints stage-aware progress for discovery, downloads, embedding batches, and writes. If embedding model dimensions do not match the existing LanceDB index, the command fails before writing mismatched vectors.

---

### `search`

Search indexed symbols by name or file.

```bash
free-context search [query] [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `query` | optional | Text to search for |
| `--path <path>` | `.` | Root to index before searching |
| `--file <path>` | unset | Restrict results to one relative file path |
| `--path-prefix <prefix>` | unset | Restrict results to file paths under one prefix |
| `--kind <kind>` | unset | Restrict results to one symbol kind |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--embed` | off | Enable a query embedder |
| `--embedder <name>` | `none` | `none`, `ollama`, `openai_compatible`, `nvidia_nemotron`, `step_3_5_flash`, or `minimax_2_5` |
| `--embedding-model-id <id>` | embedder default | Override the embedding model name |
| `--embedding-base-url <url>` | unset | Base URL for `ollama` or `openai_compatible` |
| `--embedding-dimensions <n>` | embedder default | Embedding dimensions override |
| `--semantic` | off | Use semantic vector search |
| `--hybrid` | off | Use hybrid full-text + semantic search |
| `--reindex` | off | Refresh the index before searching |
| `--limit <n>` | `20` | Max results |

At least one of `query` or `--file` is required.
`--semantic` and `--hybrid` require a text query.

Output format:
```
function      greet                          src/utils.ts:12
class         AuthService                    src/auth/service.ts:1
```

---

### `search-paths`

Search indexed file paths directly.

```bash
free-context search-paths [query] [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `query` | empty string | Substring to match within indexed file paths |
| `--path <path>` | `.` | Root to index before searching |
| `--path-prefix <prefix>` | unset | Restrict results to one directory prefix |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--reindex` | off | Refresh the index before searching |
| `--limit <n>` | `20` | Max results |

At least one of `query` or `--path-prefix` is required.

Output format:
```text
src/auth/service.ts
src/auth/types.ts
```

---

### `who-calls`

```bash
free-context who-calls <symbolName> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <path>` | `.` | Root path to query |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--reindex` | off | Refresh the index before querying |

Returns symbols that call the requested symbol.

### `what-does-this-call`

```bash
free-context what-does-this-call <symbolName> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <path>` | `.` | Root path to query |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--reindex` | off | Refresh the index before querying |

Returns symbols called by the requested symbol.

### `recently-changed`

```bash
free-context recently-changed [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <path>` | `.` | Root path to query |
| `--since <ref>` | unset | Git revision or range start |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--reindex` | off | Refresh the index before querying |

Lists indexed symbols from files changed relative to `HEAD` or the supplied revision.

### `codebase-map`

```bash
free-context codebase-map [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <path>` | `.` | Root path to query |
| `--storage <type>` | `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | `.free-context/db` | Path to LanceDB data |
| `--reindex` | off | Refresh the index before querying |

Example output:
```
repoId: repo-abc123
files: 12
symbols: 188
edges: 74
class: 12
function: 49
method: 61
```

---

### `serve`

Start the MCP server.

```bash
free-context serve [path] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `path` | `.` | Project root to serve |
| `--port <n>` | `3100` | Port for the MCP HTTP server |
| `--host <host>` | `127.0.0.1` | Host interface to bind |
| `--repo-id <id>` | from config or root hash | Stable repository ID |
| `--storage <type>` | from config or `memory` | `memory` or `lancedb` |
| `--storage-path <path>` | from config or `.free-context/db` | Path to LanceDB data |
| `--embed` | from config or off | Generate embeddings while indexing |
| `--embedder <name>` | from config or `none` | `none`, `ollama`, `openai_compatible`, `nvidia_nemotron`, `step_3_5_flash`, or `minimax_2_5` |
| `--embedding-model-id <id>` | from config | Override the embedding model name |
| `--embedding-base-url <url>` | from config | Base URL for `ollama` or `openai_compatible` |
| `--embedding-dimensions <n>` | from config | Embedding dimensions override |
| `--no-reindex` | off | Skip the initial incremental index pass before serving |

Behavior:
- Loads `.free-context.json` from the project root if present
- Merges CLI flags over project config
- Runs one incremental index pass before accepting MCP requests unless `--no-reindex` is set
- Serves Streamable HTTP at `/mcp`
- Exposes a health endpoint at `/health`

Example output:
```
MCP server listening at http://127.0.0.1:3100/mcp
Health check: http://127.0.0.1:3100/health
```

---

## Embedding argument guide

### Default local Ollama

```bash
ollama pull qwen3-embedding:0.6b
free-context serve . --storage lancedb --embed
```

Equivalent explicit form:

```bash
free-context serve . \
  --storage lancedb \
  --embed \
  --embedder ollama \
  --embedding-model-id qwen3-embedding:0.6b \
  --embedding-base-url http://127.0.0.1:11434 \
  --embedding-dimensions 1024
```

### Remote Ollama host

```bash
free-context index . \
  --storage lancedb \
  --embed \
  --embedder ollama \
  --embedding-base-url http://10.0.0.20:11434
```

### Change Ollama models

```bash
free-context index . \
  --storage lancedb \
  --embed \
  --embedder ollama \
  --embedding-model-id qwen3-embedding:8b \
  --embedding-dimensions 4096
```

When the model or vector size changes, rebuild the index. FreeContext rejects mismatched vectors before write or semantic search.

### OpenAI-compatible server

```bash
free-context search "serialised async writes" \
  --storage lancedb \
  --embed \
  --embedder openai_compatible \
  --embedding-base-url http://127.0.0.1:8080/v1 \
  --embedding-model-id text-embedding-qwen \
  --embedding-dimensions 1024 \
  --semantic
```

### `setup-agent`

Print the recommended MCP stack plus client-specific FreeContext setup instructions.

```bash
free-context setup-agent <client> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `client` | required | `claude-code`, `cursor`, `codex`, `gemini-cli`, or `opencode` |
| `--path <path>` | `.` | Project root to serve |
| `--host <host>` | `127.0.0.1` | Host interface for the MCP server |
| `--port <n>` | `3100` | Port for the MCP server |
| `--scout-provider <name>` | unset | Optional scout provider: `anthropic`, `openai`, or `openrouter` |
| `--scout-model <id>` | provider default | Optional scout model override |

Examples:

```bash
free-context setup-agent claude-code
free-context setup-agent codex --scout-provider openrouter
```

Behavior:
- Prints the recommended MCP stack for coding workflows
- Prints the exact FreeContext MCP config snippet or command for the selected client
- Prints a scout-model env template when `--scout-provider` is set
