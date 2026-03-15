import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorage } from "../storage/memory-storage.js";
import { SearchService } from "../search/search-service.js";
import type { CodeSymbolRow } from "../types/index.js";

function makeSymbol(overrides: Partial<CodeSymbolRow> = {}): CodeSymbolRow {
  return {
    id: "sym-1",
    repoId: "repo-1",
    filePath: "src/index.ts",
    language: "typescript",
    symbolName: "myFunction",
    symbolKind: "function",
    startLine: 1,
    endLine: 5,
    hash: "abc123",
    parserVersion: "1.0.0",
    embeddingModelId: null,
    rawText: "function myFunction() {}",
    imports: [],
    exports: [],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: Date.now(),
    gitCommit: null,
    embedding: null,
    ...overrides,
  };
}

describe("SearchService", () => {
  let storage: MemoryStorage;
  let search: SearchService;

  beforeEach(async () => {
    storage = new MemoryStorage();
    search = new SearchService(storage);
    await storage.upsertSymbols([
      makeSymbol({ id: "1", symbolName: "SearchService", symbolKind: "class" }),
      makeSymbol({ id: "2", symbolName: "Indexer", symbolKind: "class" }),
      makeSymbol({ id: "3", symbolName: "searchFiles", symbolKind: "function" }),
    ]);
  });

  it("finds symbols by name", async () => {
    const results = await search.findSymbol("Indexer");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("Indexer");
  });

  it("finds symbols by partial name", async () => {
    const results = await search.search({ text: "search" });
    expect(results).toHaveLength(2);
  });

  it("finds symbols by kind", async () => {
    const results = await search.findSymbol("search", "function");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("searchFiles");
  });

  it("lists file symbols", async () => {
    const results = await search.listFileSymbols("src/index.ts", "repo-1");
    expect(results).toHaveLength(3);
  });
});
