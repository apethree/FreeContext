import { beforeEach, describe, expect, it } from "vitest";
import { GraphService } from "../graph/graph-service.js";
import { MemoryStorage } from "../storage/memory-storage.js";
import type { CodeSymbolRow, EdgeRow } from "../types/index.js";

function makeSymbol(overrides: Partial<CodeSymbolRow> = {}): CodeSymbolRow {
  return {
    id: "sym-1",
    repoId: "repo-1",
    filePath: "src/index.ts",
    language: "typescript",
    symbolName: "helper",
    symbolKind: "function",
    startLine: 1,
    endLine: 3,
    hash: "hash",
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

function makeEdge(overrides: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: "edge-1",
    repoId: "repo-1",
    fromSymbolId: "caller",
    toSymbolId: "callee",
    edgeKind: "calls",
    filePath: "src/index.ts",
    ...overrides,
  };
}

describe("GraphService", () => {
  let storage: MemoryStorage;
  let graph: GraphService;

  beforeEach(async () => {
    storage = new MemoryStorage();
    graph = new GraphService(storage);

    await storage.upsertSymbols([
      makeSymbol({ id: "caller", symbolName: "main" }),
      makeSymbol({ id: "callee", symbolName: "helper" }),
      makeSymbol({ id: "other", symbolName: "other", filePath: "src/other.ts" }),
      makeSymbol({ id: "file-summary", symbolName: "src/index.ts", symbolKind: "file_summary", rawText: "" }),
    ]);

    await storage.upsertEdges([
      makeEdge({ id: "edge-a", fromSymbolId: "caller", toSymbolId: "callee" }),
      makeEdge({ id: "edge-b", fromSymbolId: "caller", toSymbolId: "other" }),
    ]);
  });

  it("finds callers for a symbol", async () => {
    const callers = await graph.whoCalls("helper", "repo-1");
    expect(callers).toHaveLength(1);
    expect(callers[0]!.symbolName).toBe("main");
  });

  it("finds callees for a symbol", async () => {
    const callees = await graph.whatDoesThisCall("main", "repo-1");
    expect(callees).toHaveLength(2);
    expect(callees.map((symbol) => symbol.symbolName)).toEqual(["helper", "other"]);
  });

  it("falls back to symbol call metadata when outbound call edges are missing", async () => {
    const storageWithoutEdges = new MemoryStorage();
    const graphWithFallback = new GraphService(storageWithoutEdges);

    await storageWithoutEdges.upsertSymbols([
      makeSymbol({ id: "caller", symbolName: "main", calls: ["helper", "service.other"] }),
      makeSymbol({ id: "callee", symbolName: "helper" }),
      makeSymbol({ id: "other", symbolName: "other", filePath: "src/other.ts" }),
    ]);

    const callees = await graphWithFallback.whatDoesThisCall("main", "repo-1");
    expect(callees).toHaveLength(2);
    expect(callees.map((symbol) => symbol.symbolName)).toEqual(["helper", "other"]);
  });

  it("falls back to symbol call metadata when inbound call edges are missing", async () => {
    const storageWithoutEdges = new MemoryStorage();
    const graphWithFallback = new GraphService(storageWithoutEdges);

    await storageWithoutEdges.upsertSymbols([
      makeSymbol({ id: "caller", symbolName: "main", calls: ["helper"] }),
      makeSymbol({ id: "caller-2", symbolName: "secondary", calls: ["module.helper"] }),
      makeSymbol({ id: "callee", symbolName: "helper" }),
    ]);

    const callers = await graphWithFallback.whoCalls("helper", "repo-1");
    expect(callers).toHaveLength(2);
    expect(callers.map((symbol) => symbol.symbolName)).toEqual(["main", "secondary"]);
  });

  it("builds a codebase map summary", async () => {
    const summary = await graph.codebaseMap("repo-1");
    expect(summary.repoId).toBe("repo-1");
    expect(summary.files).toBe(2);
    expect(summary.symbols).toBe(3);
    expect(summary.edges).toBe(2);
    expect(summary.byKind.function).toBe(3);
  });
});
