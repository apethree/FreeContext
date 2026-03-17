import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorage } from "../storage/memory-storage.js";
import { SearchService } from "../search/search-service.js";
import type { CodeSymbolRow, Embedder } from "../types/index.js";

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

  it("finds exact symbols without returning partial name matches", async () => {
    const results = await search.findSymbol("SearchService");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("SearchService");
  });

  it("finds symbols by kind", async () => {
    const results = await search.findSymbol("searchFiles", "function");
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("searchFiles");
  });

  it("lists file symbols", async () => {
    const results = await search.listFileSymbols("src/index.ts", "repo-1");
    expect(results).toHaveLength(3);
  });

  it("filters symbol search by path prefix", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "4", filePath: "src/auth/service.ts", symbolName: "AuthService" }),
      makeSymbol({ id: "5", filePath: "docs/auth.md", symbolName: "AuthDocs" }),
    ]);

    const results = await search.search({ text: "auth", pathPrefix: "src/" });

    expect(results.every((symbol) => symbol.filePath.startsWith("src/"))).toBe(true);
  });

  it("searches indexed file paths", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "4", filePath: "src/auth/service.ts" }),
      makeSymbol({ id: "5", filePath: "src/auth/index.ts" }),
      makeSymbol({ id: "6", filePath: "docs/auth.md" }),
    ]);

    const results = await search.searchPaths({
      repoId: "repo-1",
      query: "auth",
      pathPrefix: "src/",
    });

    expect(results).toEqual(["src/auth/index.ts", "src/auth/service.ts"]);
  });

  it("fails semantic search when the configured embedding metadata does not match the repo", async () => {
    const embedder: Embedder = {
      modelId: "ollama:qwen3-embedding:8b",
      dimensions: 4096,
      async embedTexts() {
        return [new Array(4096).fill(0)];
      },
    };
    await storage.upsertSymbols([
      makeSymbol({
        id: "embedded",
        repoId: "repo-1",
        embeddingModelId: "ollama:qwen3-embedding:0.6b",
        embedding: [1, 0, 0],
      }),
    ]);
    search = new SearchService(storage, embedder);

    await expect(
      search.search({
        repoId: "repo-1",
        text: "auth helpers",
        mode: "semantic",
      })
    ).rejects.toThrow(/Embedding dimension mismatch/);
  });
});
