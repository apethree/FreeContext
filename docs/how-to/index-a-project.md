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
```

The CLI prints:
```
Indexing /path/to/my-project...
Indexed 42 files, 318 symbols
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

Automatically ignored:
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

## Phase 2: persistent + semantic indexing

Once Phase 2 is available:

```bash
# Index with LanceDB storage (persists to .lancedb/)
free-context index . --storage lancedb

# Index with embeddings enabled (enables semantic search)
free-context index . --storage lancedb --embed
```

The LanceDB index is stored at `.lancedb/` in the project root by default.
