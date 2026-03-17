import { describe, expect, it } from "vitest";
import { RepoSymbolMap } from "../graph/repo-symbol-map.js";
import type { CodeSymbolRow } from "../types/index.js";

function makeSymbol(overrides: Partial<CodeSymbolRow> = {}): CodeSymbolRow {
  return {
    id: "sym-1",
    repoId: "repo-1",
    filePath: "src/index.ts",
    language: "typescript",
    symbolName: "example",
    symbolKind: "function",
    startLine: 1,
    endLine: 2,
    hash: "hash",
    parserVersion: "1.0.0",
    embeddingModelId: null,
    rawText: "function example() {}",
    imports: [],
    exports: [],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: 0,
    gitCommit: null,
    embedding: null,
    ...overrides,
  };
}

describe("RepoSymbolMap", () => {
  it("finds exact non-test symbols by name", () => {
    const map = new RepoSymbolMap([
      makeSymbol({ id: "a", symbolName: "dispatchPlugin" }),
    ]);

    expect(map.findExact("dispatchPlugin")?.id).toBe("a");
  });

  it("normalizes member references to the last segment", () => {
    const map = new RepoSymbolMap([
      makeSymbol({ id: "a", symbolName: "dispatchPlugin" }),
    ]);

    expect(map.findReference("registry.dispatchPlugin")?.id).toBe("a");
  });

  it("returns null for ambiguous matches", () => {
    const map = new RepoSymbolMap([
      makeSymbol({ id: "a", symbolName: "dispatchPlugin", filePath: "src/a.ts" }),
      makeSymbol({ id: "b", symbolName: "dispatchPlugin", filePath: "src/b.ts" }),
    ]);

    expect(map.findExact("dispatchPlugin")).toBeNull();
  });
});
