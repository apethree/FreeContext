import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  CodeSymbolRow,
  FileProvider,
  LanguageParser,
  Embedder,
  IndexStorage,
} from "../types/index.js";
import { contentHash } from "../parser/hash.js";

export interface IndexerOptions {
  repoId: string;
  rootPath: string;
  fileProvider: FileProvider;
  parser: LanguageParser;
  embedder: Embedder;
  storage: IndexStorage;
  extensions?: string[];
}

export class Indexer {
  private opts: IndexerOptions;

  constructor(opts: IndexerOptions) {
    this.opts = opts;
  }

  async indexAll(): Promise<{ filesIndexed: number; symbolsIndexed: number }> {
    const { repoId, rootPath, fileProvider, parser, embedder, storage, extensions } =
      this.opts;

    const files = await fileProvider.listFiles(rootPath, extensions);
    let symbolsIndexed = 0;

    for (const relPath of files) {
      const absPath = join(rootPath, relPath);
      const content = await fileProvider.readFile(absPath);
      const parsed = parser.parseFile(relPath, content);

      const symbols: CodeSymbolRow[] = parsed.map((sym) => ({
        id: randomUUID(),
        repoId,
        filePath: relPath,
        language: this.detectLanguage(relPath),
        symbolName: sym.symbolName,
        symbolKind: sym.symbolKind,
        startLine: sym.startLine,
        endLine: sym.endLine,
        hash: contentHash(sym.rawText),
        parserVersion: parser.parserVersion,
        embeddingModelId: embedder.modelId !== "noop" ? embedder.modelId : null,
        rawText: sym.rawText,
        imports: sym.imports,
        exports: sym.exports,
        calls: sym.calls,
        isTest: this.isTestFile(relPath),
        tags: [],
        modifiedAt: Date.now(),
        gitCommit: null,
        embedding: null,
      }));

      if (embedder.modelId !== "noop" && symbols.length > 0) {
        const texts = symbols.map((s) => s.rawText);
        const embeddings = await embedder.embedTexts(texts);
        for (let i = 0; i < symbols.length; i++) {
          symbols[i]!.embedding = embeddings[i] ?? null;
        }
      }

      // Clear old symbols for this file then insert new
      await storage.deleteSymbolsByFile(repoId, relPath);
      await storage.upsertSymbols(symbols);
      symbolsIndexed += symbols.length;
    }

    return { filesIndexed: files.length, symbolsIndexed };
  }

  private detectLanguage(filePath: string): string {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
    return "unknown";
  }

  private isTestFile(filePath: string): boolean {
    return (
      filePath.includes("__tests__") ||
      filePath.includes(".test.") ||
      filePath.includes(".spec.") ||
      filePath.includes("/test/")
    );
  }
}
