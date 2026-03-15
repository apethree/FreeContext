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
  storagePath?: string;  // Path for LanceDB data (Phase 2)
  embed: boolean;        // Enable embedding generation (Phase 2)
}
```

### Defaults

```ts
{
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignore: ["node_modules", "dist", ".git", "build", "coverage", ".next"],
  storage: "memory",
  embed: false,
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
  "extensions": [".ts", ".tsx"],
  "ignore": ["node_modules", "dist", "fixtures"]
}
```

When `free-context serve` starts, it looks for `.free-context.json` in the project root and merges it with CLI flags (flags win).
