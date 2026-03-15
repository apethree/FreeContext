# Data Model

---

## CodeSymbolRow

The primary unit of indexed data. One row per symbol (function, class, interface, etc.).

```ts
interface CodeSymbolRow {
  id: string;              // UUID
  repoId: string;          // project/tenant identifier
  filePath: string;        // relative to repo root
  language: string;        // "typescript" | "javascript"
  symbolName: string;      // "SearchService"
  symbolKind: SymbolKind;  // see below
  startLine: number;       // 1-indexed
  endLine: number;         // 1-indexed
  hash: string;            // SHA-256 of rawText, first 16 hex chars
  parserVersion: string;   // "1.0.0"
  embeddingModelId: string | null;
  rawText: string;         // full source text of the symbol
  imports: string[];       // module specifiers this symbol imports
  exports: string[];       // names this symbol exports
  calls: string[];         // call expressions within this symbol
  isTest: boolean;         // true if in __tests__/ or *.test.ts
  tags: string[];          // reserved for future use
  modifiedAt: number;      // Unix ms
  gitCommit: string | null;
  embedding: number[] | null;
}
```

### SymbolKind values

| Kind | When used |
|------|----------|
| `function` | `function foo()`, `const foo = () =>` |
| `method` | `method()` inside a class |
| `class` | `class Foo` |
| `interface` | `interface Foo` |
| `type_alias` | `type Foo = ...` |
| `variable` | `const x = 42` |
| `import` | `import { x } from "..."` |
| `export` | re-export statements |
| `file_summary` | reserved for Phase 3 codebase map |

---

## EdgeRow

Represents a directed relationship between two symbols. Populated in Phase 3.

```ts
interface EdgeRow {
  id: string;
  repoId: string;
  fromSymbolId: string;
  toSymbolId: string;
  edgeKind: EdgeKind;    // "calls" | "imports" | "implements" | "extends"
  filePath: string;
}
```

---

## Hashing

`contentHash(text)` uses Node's built-in `crypto.createHash("sha256")`. The first 16 hex characters are stored. This is sufficient for change detection (collision probability negligible for codebase sizes).

Used for:
- Incremental indexing (Phase 3): skip symbols whose hash hasn't changed
- Deduplication: detect when the same function moves between files
