import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "@lancedb/lancedb";
import { chunkPredicates, LanceDbStorage } from "../storage/lancedb-storage.js";
import type { CodeSymbolRow, EdgeRow } from "../types/index.js";

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
    embeddingModelId: "test-model",
    rawText: "function myFunction() {}",
    imports: [],
    exports: [],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: Date.now(),
    gitCommit: null,
    embedding: [1, 0],
    ...overrides,
  };
}

describe("LanceDbStorage", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  async function makeStorage(): Promise<LanceDbStorage> {
    const dir = await mkdtemp(join(tmpdir(), "free-context-lancedb-"));
    tempDirs.push(dir);
    return new LanceDbStorage({
      path: join(dir, "db"),
      vectorDimensions: 2,
    });
  }

  it("upserts and retrieves symbols by id", async () => {
    const storage = await makeStorage();
    const symbol = makeSymbol();

    expect(await storage.getSymbolById(symbol.id)).toBeNull();
    await storage.upsertSymbols([symbol]);

    expect(await storage.getSymbolById(symbol.id)).toEqual(symbol);
  });

  it("runs full-text searches scoped by repo", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "auth-1",
        repoId: "repo-1",
        symbolName: "AuthService",
        rawText: "class AuthService { login() {} }",
      }),
      makeSymbol({
        id: "auth-2",
        repoId: "repo-2",
        symbolName: "AuthService",
        rawText: "class AuthService { login() {} }",
      }),
    ]);

    const results = await storage.searchSymbols({
      repoId: "repo-1",
      text: "AuthService",
      mode: "fulltext",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.repoId).toBe("repo-1");
  });

  it("runs semantic searches using stored vectors", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "auth",
        symbolName: "AuthService",
        rawText: "class LoginHandler { authenticateUser() {} }",
        embedding: [1, 0],
      }),
      makeSymbol({
        id: "billing",
        symbolName: "BillingService",
        embedding: [0, 1],
      }),
    ]);

    const results = await storage.searchSymbols({
      repoId: "repo-1",
      text: "functions that handle auth",
      embedding: [1, 0],
      mode: "semantic",
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.symbolName).toBe("AuthService");
  });

  it("deduplicates upserts by symbol id", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({ id: "dup", symbolName: "OldName" }),
    ]);
    await storage.upsertSymbols([
      makeSymbol({ id: "dup", symbolName: "NewName" }),
    ]);

    const result = await storage.getSymbolById("dup");
    const results = await storage.searchSymbols({
      repoId: "repo-1",
      text: "NewName",
      mode: "fulltext",
    });

    expect(result?.symbolName).toBe("NewName");
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("dup");
  });

  it("runs hybrid search and fuses text and vector matches", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "semantic-hit",
        symbolName: "LoginHandler",
        rawText: "class LoginHandler { authenticateUser() {} }",
        embedding: [1, 0],
      }),
      makeSymbol({
        id: "text-hit",
        symbolName: "AuthHelpers",
        rawText: "functions that handle auth",
        embedding: [0, 1],
      }),
    ]);

    const results = await storage.searchSymbols({
      repoId: "repo-1",
      text: "functions that handle auth",
      embedding: [1, 0],
      mode: "hybrid",
      limit: 5,
    });

    expect(results.map((result) => result.id)).toContain("semantic-hit");
    expect(results.map((result) => result.id)).toContain("text-hit");
  });

  it("filters symbol search by path prefix", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({ id: "auth-1", filePath: "src/auth/service.ts", symbolName: "AuthService" }),
      makeSymbol({ id: "auth-2", filePath: "docs/auth.md", symbolName: "AuthDocs" }),
    ]);

    const results = await storage.searchSymbols({
      repoId: "repo-1",
      text: "auth",
      pathPrefix: "src/",
      mode: "fulltext",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.filePath).toBe("src/auth/service.ts");
  });

  it("searches distinct indexed file paths", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({ id: "a", filePath: "src/auth/service.ts" }),
      makeSymbol({ id: "b", filePath: "src/auth/index.ts" }),
      makeSymbol({ id: "c", filePath: "docs/auth.md" }),
      makeSymbol({
        id: "summary",
        filePath: "src/empty.ts",
        symbolName: "src/empty.ts",
        symbolKind: "file_summary",
        rawText: "",
        hash: "summary-hash",
        embeddingModelId: null,
        embedding: null,
      }),
    ]);

    const results = await storage.searchPaths({
      repoId: "repo-1",
      query: "auth",
      pathPrefix: "src/",
    });

    expect(results).toEqual(["src/auth/index.ts", "src/auth/service.ts"]);
  });

  it("deduplicates edge upserts and indexes edge lookups", async () => {
    const storage = await makeStorage();
    const edge: EdgeRow = {
      id: "edge-1",
      repoId: "repo-1",
      fromSymbolId: "from-1",
      toSymbolId: "to-1",
      edgeKind: "calls",
      filePath: "src/index.ts",
    };

    await storage.upsertEdges([edge]);
    await storage.upsertEdges([{ ...edge, toSymbolId: "to-2" }]);

    const fromEdges = await storage.getEdgesFrom("from-1");
    const toEdges = await storage.getEdgesTo("to-2");

    expect(fromEdges).toHaveLength(1);
    expect(fromEdges[0]!.toSymbolId).toBe("to-2");
    expect(toEdges).toHaveLength(1);
    expect(toEdges[0]!.id).toBe("edge-1");
  });

  it("chunks large delete predicates before handing them to LanceDB", () => {
    const predicates = Array.from(
      { length: 1400 },
      (_, index) => `id = 'edge-${index.toString().padStart(4, "0")}'`
    );

    const chunks = chunkPredicates(predicates, 512);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(predicates);
    expect(chunks.every((chunk) => chunk.join(" OR ").length <= 512)).toBe(true);
  });

  it("serializes concurrent symbol table initialization", async () => {
    const storage = await makeStorage();

    await Promise.all([
      storage.upsertSymbols([
        makeSymbol({ id: "sym-a", symbolName: "Alpha", filePath: "src/a.ts" }),
      ]),
      storage.upsertSymbols([
        makeSymbol({ id: "sym-b", symbolName: "Beta", filePath: "src/b.ts" }),
      ]),
    ]);

    const alpha = await storage.getSymbolById("sym-a");
    const beta = await storage.getSymbolById("sym-b");

    expect(alpha?.symbolName).toBe("Alpha");
    expect(beta?.symbolName).toBe("Beta");
  });

  it("serializes concurrent edge table initialization", async () => {
    const storage = await makeStorage();

    await Promise.all([
      storage.upsertEdges([
        {
          id: "edge-a",
          repoId: "repo-1",
          fromSymbolId: "from-a",
          toSymbolId: "to-a",
          edgeKind: "calls",
          filePath: "src/a.ts",
        },
      ]),
      storage.upsertEdges([
        {
          id: "edge-b",
          repoId: "repo-1",
          fromSymbolId: "from-b",
          toSymbolId: "to-b",
          edgeKind: "imports",
          filePath: "src/b.ts",
        },
      ]),
    ]);

    expect(await storage.getEdgesFrom("from-a")).toHaveLength(1);
    expect(await storage.getEdgesFrom("from-b")).toHaveLength(1);
  });

  it("returns embedding metadata from persisted vectors", async () => {
    const storage = await makeStorage();
    await storage.upsertSymbols([
      makeSymbol({
        id: "embedded",
        repoId: "repo-1",
        embeddingModelId: "ollama:qwen3",
        embedding: [1, 0],
      }),
    ]);

    await expect(storage.getEmbeddingMetadata("repo-1")).resolves.toEqual({
      modelId: "ollama:qwen3",
      dimensions: 2,
    });
  });

  it("fails early when embeddings are written into a legacy symbols table without embedding columns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "free-context-lancedb-legacy-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "db");
    const db = await connect(dbPath);
    await db.createTable("symbols", [
      {
        id: "legacy-1",
        repoId: "repo-1",
        filePath: "src/legacy.ts",
        language: "typescript",
        symbolName: "Legacy",
        symbolKind: "function",
        startLine: 1,
        endLine: 1,
        hash: "hash",
        parserVersion: "1.0.0",
        rawText: "function Legacy() {}",
        importsJson: "[]",
        exportsJson: "[]",
        callsJson: "[]",
        isTest: false,
        tagsJson: "[]",
        modifiedAt: Date.now(),
        gitCommitValue: "",
        searchText: "Legacy",
      },
    ]);

    const storage = new LanceDbStorage({
      path: dbPath,
      vectorDimensions: 2,
    });

    await expect(
      storage.upsertSymbols([
        makeSymbol({
          id: "embedded",
          repoId: "repo-1",
          embeddingModelId: "ollama:qwen3",
          embedding: [1, 0],
        }),
      ])
    ).rejects.toThrow(/missing embedding columns/);
  });
});
