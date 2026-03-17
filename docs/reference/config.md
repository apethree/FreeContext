---
title: Config Reference
---

# Config Reference

---

## CodeIntelConfig

Passed to `CodeIntelEngine` constructor or loaded from `.free-context.json` (Phase 4).

```ts
interface CodeIntelConfig {
  repoId: string;        // Stable project identifier
  rootPath: string;      // Absolute path to codebase root
  extensions: string[];  // File extensions to index
  ignore: string[];      // Directory/file patterns to skip
  storage: "memory" | "lancedb";
  storagePath?: string;  // Path for LanceDB data
  embed: boolean;        // Enable embedding generation
  embedder:
    | "none"
    | "ollama"
    | "openai_compatible"
    | "nvidia_nemotron"
    | "step_3_5_flash"
    | "minimax_2_5";
  embeddingModelId?: string;
  embeddingBaseUrl?: string;
  embeddingDimensions?: number;
}
```

### Defaults

```ts
{
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignore: ["node_modules", "dist", "dist-docs", ".git", "build", "coverage", ".next"],
  storage: "memory",
  embed: false,
  embedder: "none",
}
```

---

## .free-context.json *(Phase 4)*

Project-local config file. Placed at the root of the project being indexed.

```json
{
  "repoId": "my-project",
  "storage": "lancedb",
  "storagePath": ".free-context/db",
  "embed": true,
  "embedder": "ollama",
  "embeddingBaseUrl": "http://127.0.0.1:11434",
  "embeddingDimensions": 1024,
  "extensions": [".ts", ".tsx"],
  "ignore": ["node_modules", "dist", "fixtures"]
}
```

`free-context serve` loads `.free-context.json` from the project root and merges CLI flags over it (flags win).
`storagePath` is resolved relative to the project root before engine creation.

`storagePath`, `embed`, `embedder`, `embeddingModelId`, `embeddingBaseUrl`, and `embeddingDimensions` control LanceDB persistence and embedding generation.

Defaults:
- `--embed` with no explicit embedder uses `ollama`
- default Ollama model: `qwen3-embedding:0.6b`
- default Ollama host: `http://127.0.0.1:11434`

Notes:
- `openai_compatible` is intended for local or remote `/v1/embeddings` servers
- semantic and hybrid search require the active embedder to match the stored index model and vector dimensions
- if you change `embeddingModelId` or `embeddingDimensions`, rebuild the index
Provider-backed embedders use these environment variables by default:
- `NVIDIA_API_KEY` for `nvidia_nemotron`
- `STEP_API_KEY` for `step_3_5_flash`
- `MINIMAX_API_KEY` for `minimax_2_5`

Local HTTP embedders use:
- `OLLAMA_HOST`
- `OLLAMA_EMBEDDING_MODEL`
- `OPENAI_COMPATIBLE_BASE_URL`
- `OPENAI_COMPATIBLE_MODEL`
- `OPENAI_COMPATIBLE_API_KEY`

Example: remote Ollama config

```json
{
  "storage": "lancedb",
  "storagePath": ".free-context/db",
  "embed": true,
  "embedder": "ollama",
  "embeddingBaseUrl": "http://10.0.0.20:11434",
  "embeddingModelId": "qwen3-embedding:0.6b",
  "embeddingDimensions": 1024
}
```

Example: OpenAI-compatible local server

```json
{
  "storage": "lancedb",
  "embed": true,
  "embedder": "openai_compatible",
  "embeddingBaseUrl": "http://127.0.0.1:8080/v1",
  "embeddingModelId": "text-embedding-qwen",
  "embeddingDimensions": 1024
}
```
