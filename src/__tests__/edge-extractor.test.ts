import { describe, expect, it } from "vitest";
import { EdgeExtractor } from "../graph/edge-extractor.js";
import { MemoryStorage } from "../storage/memory-storage.js";
import type { CodeSymbolRow, ParsedSymbol } from "../types/index.js";

function makeParsedSymbol(overrides: Partial<ParsedSymbol> = {}): ParsedSymbol {
  return {
    symbolName: "helper",
    symbolKind: "function",
    startLine: 1,
    endLine: 3,
    rawText: "function helper() {}",
    imports: [],
    importBindings: [],
    exports: [],
    calls: [],
    extendsTypes: [],
    implementsTypes: [],
    ...overrides,
  };
}

function makeSymbol(overrides: Partial<CodeSymbolRow> = {}): CodeSymbolRow {
  return {
    id: "sym-1",
    repoId: "repo-1",
    filePath: "src/current.ts",
    language: "typescript",
    symbolName: "helper",
    symbolKind: "function",
    startLine: 1,
    endLine: 3,
    hash: "abc123",
    parserVersion: "1.0.0",
    embeddingModelId: null,
    rawText: "function helper() {}",
    imports: [],
    exports: [],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: 1,
    gitCommit: null,
    embedding: null,
    ...overrides,
  };
}

describe("EdgeExtractor", () => {
  it("creates call edges to symbols in the same file", async () => {
    const storage = new MemoryStorage();
    const extractor = new EdgeExtractor({
      repoId: "repo-1",
      filePath: "src/current.ts",
      parsedSymbols: [
        makeParsedSymbol({ symbolName: "helper" }),
        makeParsedSymbol({ symbolName: "main", calls: ["helper"], rawText: "function main() { helper(); }" }),
      ],
      symbolRows: [
        makeSymbol({ id: "helper-id", symbolName: "helper" }),
        makeSymbol({ id: "main-id", symbolName: "main", rawText: "function main() { helper(); }", startLine: 5 }),
      ],
      storage,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    });

    const edges = await extractor.extractEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.edgeKind).toBe("calls");
    expect(edges[0]!.fromSymbolId).toBe("main-id");
    expect(edges[0]!.toSymbolId).toBe("helper-id");
  });

  it("resolves imported inheritance references against indexed files", async () => {
    const storage = new MemoryStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "base-id",
        filePath: "src/base.ts",
        symbolName: "BaseUser",
        symbolKind: "class",
        exports: ["BaseUser", "default"],
      }),
      makeSymbol({
        id: "base-file",
        filePath: "src/base.ts",
        symbolName: "src/base.ts",
        symbolKind: "file_summary",
        hash: "file-hash",
        rawText: "",
      }),
    ]);

    const extractor = new EdgeExtractor({
      repoId: "repo-1",
      filePath: "src/current.ts",
      parsedSymbols: [
        makeParsedSymbol({
          symbolName: "./base.js",
          symbolKind: "import",
          rawText: "import BaseUser from './base.js';",
          imports: ["./base.js"],
          importBindings: [
            {
              source: "./base.js",
              importedName: "default",
              localName: "BaseUser",
            },
          ],
        }),
        makeParsedSymbol({
          symbolName: "AdminUser",
          symbolKind: "class",
          rawText: "class AdminUser extends BaseUser {}",
          extendsTypes: ["BaseUser"],
        }),
      ],
      symbolRows: [
        makeSymbol({
          id: "import-id",
          symbolName: "./base.js",
          symbolKind: "import",
          rawText: "import BaseUser from './base.js';",
        }),
        makeSymbol({
          id: "admin-id",
          symbolName: "AdminUser",
          symbolKind: "class",
          rawText: "class AdminUser extends BaseUser {}",
        }),
      ],
      storage,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    });

    const edges = await extractor.extractEdges();
    expect(edges.some((edge) => edge.edgeKind === "imports" && edge.toSymbolId === "base-id")).toBe(true);
    expect(edges.some((edge) => edge.edgeKind === "extends" && edge.toSymbolId === "base-id")).toBe(true);
  });

  it("falls back to file summary edges for namespace imports", async () => {
    const storage = new MemoryStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "util-file",
        filePath: "src/utils.ts",
        symbolName: "src/utils.ts",
        symbolKind: "file_summary",
        hash: "summary",
        rawText: "",
      }),
    ]);

    const extractor = new EdgeExtractor({
      repoId: "repo-1",
      filePath: "src/current.ts",
      parsedSymbols: [
        makeParsedSymbol({
          symbolName: "./utils",
          symbolKind: "import",
          rawText: "import * as utils from './utils';",
          imports: ["./utils"],
          importBindings: [
            {
              source: "./utils",
              importedName: "*",
              localName: "utils",
            },
          ],
        }),
      ],
      symbolRows: [
        makeSymbol({
          id: "import-id",
          symbolName: "./utils",
          symbolKind: "import",
          rawText: "import * as utils from './utils';",
        }),
      ],
      storage,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    });

    const edges = await extractor.extractEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.edgeKind).toBe("imports");
    expect(edges[0]!.toSymbolId).toBe("util-file");
  });
});
