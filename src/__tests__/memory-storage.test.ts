import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorage } from "../storage/memory-storage.js";
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
    exports: ["myFunction"],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: Date.now(),
    gitCommit: null,
    embedding: null,
    ...overrides,
  };
}

describe("MemoryStorage", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("upserts and retrieves symbols by id", async () => {
    const sym = makeSymbol();
    await storage.upsertSymbols([sym]);
    const result = await storage.getSymbolById("sym-1");
    expect(result).toEqual(sym);
  });

  it("returns null for missing symbol", async () => {
    const result = await storage.getSymbolById("nonexistent");
    expect(result).toBeNull();
  });

  it("searches by text (name match)", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1", symbolName: "SearchService" }),
      makeSymbol({ id: "2", symbolName: "Indexer" }),
    ]);
    const results = await storage.searchSymbols({ text: "search" });
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("SearchService");
  });

  it("searches by file path", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1", filePath: "src/a.ts" }),
      makeSymbol({ id: "2", filePath: "src/b.ts" }),
    ]);
    const results = await storage.searchSymbols({ filePath: "src/a.ts" });
    expect(results).toHaveLength(1);
  });

  it("searches by symbol kind", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1", symbolKind: "function" }),
      makeSymbol({ id: "2", symbolKind: "class" }),
    ]);
    const results = await storage.searchSymbols({ symbolKind: "class" });
    expect(results).toHaveLength(1);
    expect(results[0]!.symbolKind).toBe("class");
  });

  it("respects limit", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1" }),
      makeSymbol({ id: "2" }),
      makeSymbol({ id: "3" }),
    ]);
    const results = await storage.searchSymbols({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("gets symbols by file", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1", repoId: "r1", filePath: "a.ts" }),
      makeSymbol({ id: "2", repoId: "r1", filePath: "b.ts" }),
    ]);
    const results = await storage.getSymbolsByFile("r1", "a.ts");
    expect(results).toHaveLength(1);
  });

  it("deletes symbols by file", async () => {
    await storage.upsertSymbols([
      makeSymbol({ id: "1", repoId: "r1", filePath: "a.ts" }),
      makeSymbol({ id: "2", repoId: "r1", filePath: "b.ts" }),
    ]);
    await storage.deleteSymbolsByFile("r1", "a.ts");
    expect(storage.symbolCount).toBe(1);
    const result = await storage.getSymbolById("1");
    expect(result).toBeNull();
  });
});
