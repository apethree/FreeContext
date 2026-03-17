import { describe, expect, it } from "vitest";
import { Indexer } from "../indexer/indexer.js";
import { TreeSitterParser } from "../parser/ts-parser.js";
import { contentHash } from "../parser/hash.js";
import { NoopEmbedder } from "../embeddings/noop-embedder.js";
import { MemoryStorage } from "../storage/memory-storage.js";
import type { ChangeTracker, Embedder, FileProvider } from "../types/index.js";

function createFileProvider(files: Record<string, string>): FileProvider {
  return {
    async listFiles() {
      return Object.keys(files);
    },
    async readFile(filePath) {
      const relPath = filePath.replace("/tmp/project/", "");
      return files[relPath] ?? "";
    },
    async stat() {
      return null;
    },
  };
}

describe("Indexer", () => {
  it("passes configured ignore entries to the file provider", async () => {
    const seen: { extensions?: string[]; ignore?: string[] } = {};
    const fileProvider: FileProvider = {
      async listFiles(_root, extensions, ignore) {
        seen.extensions = extensions;
        seen.ignore = ignore;
        return [];
      },
      async readFile() {
        return "";
      },
      async stat() {
        return null;
      },
    };

    const indexer = new Indexer({
      repoId: "repo-1",
      rootPath: "/tmp/project",
      fileProvider,
      parser: new TreeSitterParser(),
      embedder: new NoopEmbedder(),
      storage: new MemoryStorage(),
      extensions: [".ts"],
      ignore: ["fixtures", "dist"],
    });

    await indexer.indexAll();

    expect(seen.extensions).toEqual([".ts"]);
    expect(seen.ignore).toEqual(["fixtures", "dist"]);
  });

  it("skips unchanged files using the stored file summary hash", async () => {
    const storage = new MemoryStorage();
    const fileProvider = createFileProvider({
      "src/a.ts": "export function greet() { return 'hi'; }",
    });
    const changeTracker: ChangeTracker = {
      async getChangedFiles() {
        return [];
      },
      async getCurrentRevision() {
        return "commit-1";
      },
    };
    const indexer = new Indexer({
      repoId: "repo-1",
      rootPath: "/tmp/project",
      fileProvider,
      parser: new TreeSitterParser(),
      embedder: new NoopEmbedder(),
      storage,
      changeTracker,
    });

    const first = await indexer.indexAll();
    const second = await indexer.indexAll();
    const symbols = await storage.getSymbolsByFile("repo-1", "src/a.ts");
    const fileSummary = symbols.find((symbol) => symbol.symbolKind === "file_summary");

    expect(first.filesIndexed).toBe(1);
    expect(first.filesSkipped).toBe(0);
    expect(second.filesIndexed).toBe(0);
    expect(second.filesSkipped).toBe(1);
    expect(fileSummary?.hash).toBe(contentHash("export function greet() { return 'hi'; }"));
    expect(symbols).toHaveLength(2);
  });

  it("stores resolved call edges after symbols are indexed", async () => {
    const storage = new MemoryStorage();
    const fileProvider = createFileProvider({
      "src/a.ts": "function helper() {}\nfunction main() { helper(); }",
    });
    const indexer = new Indexer({
      repoId: "repo-1",
      rootPath: "/tmp/project",
      fileProvider,
      parser: new TreeSitterParser(),
      embedder: new NoopEmbedder(),
      storage,
    });

    await indexer.indexAll();

    const symbols = await storage.getSymbolsByFile("repo-1", "src/a.ts");
    const helper = symbols.find((symbol) => symbol.symbolName === "helper");
    const main = symbols.find((symbol) => symbol.symbolName === "main");
    const edges = await storage.getEdgesFrom(main!.id);

    expect(helper).toBeDefined();
    expect(main).toBeDefined();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.toSymbolId).toBe(helper!.id);
    expect(edges[0]!.edgeKind).toBe("calls");
  });

  it("fails fast when stored embedding metadata does not match the current embedder", async () => {
    const storage = new MemoryStorage();
    await storage.upsertSymbols([
      {
        id: "existing",
        repoId: "repo-1",
        filePath: "src/old.ts",
        language: "typescript",
        symbolName: "Existing",
        symbolKind: "function",
        startLine: 1,
        endLine: 1,
        hash: "old-hash",
        parserVersion: "1",
        embeddingModelId: "ollama:qwen3-embedding:0.6b",
        rawText: "function Existing() {}",
        imports: [],
        exports: [],
        calls: [],
        isTest: false,
        tags: [],
        modifiedAt: Date.now(),
        gitCommit: null,
        embedding: [1, 0, 0],
      },
    ]);
    const embedder: Embedder = {
      modelId: "ollama:qwen3-embedding:8b",
      dimensions: 4096,
      async embedTexts(texts) {
        return texts.map(() => new Array(4096).fill(0));
      },
    };
    const fileProvider = createFileProvider({
      "src/a.ts": "export function greet() { return 'hi'; }",
    });
    const indexer = new Indexer({
      repoId: "repo-1",
      rootPath: "/tmp/project",
      fileProvider,
      parser: new TreeSitterParser(),
      embedder,
      storage,
    });

    await expect(indexer.indexAll()).rejects.toThrow(/Embedding dimension mismatch/);
  });
});
