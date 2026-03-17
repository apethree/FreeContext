---
title: How to Index a Project
---

# How to index a project

---

## CLI

```bash
# Index the current directory
free-context index .

# Index a specific path
free-context index /path/to/my-project

# Index with a stable repo ID (so logs are grouped consistently)
free-context index . --repo-id my-project

# Search within one file after indexing
free-context search --file src/core/engine.ts

# Search by name and symbol kind
free-context search CodeIntelEngine --kind class

# Persist the index to LanceDB
free-context index . --storage lancedb

# Index with local Ollama embeddings
free-context index . --storage lancedb --embed
```

The CLI prints:
```
Indexing /path/to/my-project...
Indexed 42 files, skipped 0, wrote 318 symbols
```

---

## Programmatic API

```ts
import { CodeIntelEngine } from "free-context";

const engine = new CodeIntelEngine({
  rootPath: "/path/to/my-project",
  repoId: "my-project",
});

const result = await engine.index();
console.log(`Indexed ${result.filesIndexed} files, ${result.symbolsIndexed} symbols`);
```

---

## What gets indexed

All files matching the default extensions: `.ts`, `.tsx`, `.js`, `.jsx`

Automatically ignored by default:
- `node_modules/`
- `dist/`
- `.git/`
- `build/`
- `coverage/`
- `.next/`

---

## Custom extensions and ignore patterns

```ts
const engine = new CodeIntelEngine({
  rootPath: "./src",
  extensions: [".ts"],     // TypeScript only
  ignore: ["node_modules", "dist", "fixtures"],
});
```

---

The `ignore` list is configurable through `CodeIntelEngine`, and custom entries are applied during file discovery.

## Persistent + semantic indexing

```bash
# Persistent index under .free-context/db
free-context index . --storage lancedb

# Semantic index with the default local Ollama backend
ollama pull qwen3-embedding:0.6b
free-context index . --storage lancedb --embed

# Remote Ollama host
free-context index . --storage lancedb --embed \
  --embedder ollama \
  --embedding-base-url http://10.0.0.20:11434

# OpenAI-compatible embedding server
free-context index . --storage lancedb --embed \
  --embedder openai_compatible \
  --embedding-base-url http://127.0.0.1:8080/v1 \
  --embedding-model-id text-embedding-qwen \
  --embedding-dimensions 1024

# Semantic evals against a remote embedding endpoint
FREE_CONTEXT_EMBED_BASE_URL=http://192.168.1.117:8002/v1 \
  npm run eval:semantic:smoke
```

The LanceDB index is stored at `.free-context/db` in the project root by default.

If you switch embedding models or dimensions, rebuild the index. FreeContext rejects mismatched vectors instead of mixing them into the same database.

For evals, the same local-vs-remote rule applies:

- no `FREE_CONTEXT_EMBED_BASE_URL`: managed semantic eval server uses local Ollama
- with `FREE_CONTEXT_EMBED_BASE_URL`: managed semantic eval server uses `openai_compatible`

## Development
`free-context` is not installed globally in  shell.

From this repo, use one of these instead:

```bash
node dist/cli/index.js index . --storage lancedb --embed \
  --embedder openai_compatible \
  --embedding-base-url http://192.168.1.117:8002/v1 \
  --embedding-model-id qwen3-embedding:0.6b \
  --embedding-dimensions 1024
```

Or, without relying on `dist`:

```bash
npx tsx src/cli/index.ts index . --storage lancedb --embed \
  --embedder openai_compatible \
  --embedding-base-url http://192.168.1.117:8002/v1 \
  --embedding-model-id qwen3-embedding:0.6b \
  --embedding-dimensions 1024
```

If you want the bare `free-context` command, install it globally from this repo:

```bash
npm run build
npm install -g .
```
