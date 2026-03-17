import { join } from "node:path";
import type {
  ChangeTracker,
  CodeSymbolRow,
  EmbeddingProgress,
  EdgeRow,
  FileProvider,
  LanguageParser,
  Embedder,
  IndexResult,
  IndexStorage,
  ParsedSymbol,
} from "../types/index.js";
import { contentHash } from "../parser/hash.js";
import { EdgeExtractor } from "../graph/edge-extractor.js";
import { RepoSymbolMap } from "../graph/repo-symbol-map.js";
import { buildSymbolId } from "./ids.js";

export interface IndexerOptions {
  repoId: string;
  rootPath: string;
  fileProvider: FileProvider;
  parser: LanguageParser;
  embedder: Embedder;
  storage: IndexStorage;
  changeTracker?: ChangeTracker;
  extensions?: string[];
  ignore?: string[];
}

interface PreparedFile {
  filePath: string;
  parsedSymbols: ParsedSymbol[];
  symbolRows: CodeSymbolRow[];
}

export class Indexer {
  private opts: IndexerOptions;
  private embedBackendLogged = false;
  private validatedEmbeddingMetadata = false;

  constructor(opts: IndexerOptions) {
    this.opts = opts;
  }

  async indexAll(): Promise<IndexResult> {
    const { repoId, rootPath, fileProvider, parser, embedder, storage, extensions, ignore } =
      this.opts;

    const files = await fileProvider.listFiles(rootPath, extensions, ignore);
    this.logStage("discover", `found ${files.length} files`);
    const gitCommit = this.opts.changeTracker
      ? await this.opts.changeTracker.getCurrentRevision()
      : null;
    let symbolsIndexed = 0;
    let filesIndexed = 0;
    let filesSkipped = 0;
    const preparedFiles: PreparedFile[] = [];

    for (const [i, relPath] of files.entries()) {
      const pct = Math.round((i / files.length) * 100);
      const label = relPath.length > 60 ? `…${relPath.slice(-59)}` : relPath;
      process.stderr.write(`\r  [${pct.toString().padStart(3)}%] ${i + 1}/${files.length}: ${label.padEnd(60)}`);
      const absPath = join(rootPath, relPath);
      const content = await fileProvider.readFile(absPath);
      const fileHash = contentHash(content);
      const existingSymbols = await storage.getSymbolsByFile(repoId, relPath);
      const fileSummary = existingSymbols.find((symbol) => symbol.symbolKind === "file_summary");

      if (fileSummary?.hash === fileHash) {
        filesSkipped += 1;
        continue;
      }

      const parsed = parser.parseFile(relPath, content);
      const symbolRows = this.buildSymbolRows(relPath, parsed, content, fileHash, gitCommit);

      const embeddableSymbols = symbolRows.filter((symbol) => symbol.symbolKind !== "file_summary");
      if (embedder.modelId !== "noop" && embeddableSymbols.length > 0) {
        if (!this.validatedEmbeddingMetadata) {
          await this.validateEmbeddingCompatibility(storage, repoId);
          this.validatedEmbeddingMetadata = true;
        }
        const texts = embeddableSymbols.map((s) => s.rawText);
        this.logEmbedBackend(embedder);
        const heartbeat = this.startEmbedHeartbeat(relPath, texts.length);
        let embeddings: number[][];
        try {
          embeddings = await embedder.embedTexts(texts, {
            onProgress: (progress) => {
              this.logEmbeddingProgress(progress);
            },
          });
        } finally {
          clearInterval(heartbeat);
        }
        await this.validateEmbeddingDimensions(storage, repoId, embeddings[0]?.length ?? 0, embedder.modelId);
        for (let i = 0; i < embeddableSymbols.length; i++) {
          embeddableSymbols[i]!.embedding = embeddings[i] ?? null;
        }
      }

      preparedFiles.push({
        filePath: relPath,
        parsedSymbols: parsed,
        symbolRows,
      });
    }

    if (files.length > 0) {
      process.stderr.write(`\r  [100%] ${files.length}/${files.length}: done${"".padEnd(60)}\n`);
    }

    if (preparedFiles.length > 0) {
      this.logStage("write symbols", `${preparedFiles.flatMap((preparedFile) => preparedFile.symbolRows).length} rows`);
      await storage.deleteSymbolsByFiles(
        repoId,
        preparedFiles.map((preparedFile) => preparedFile.filePath)
      );
      await storage.upsertSymbols(
        preparedFiles.flatMap((preparedFile) => preparedFile.symbolRows)
      );

      for (const preparedFile of preparedFiles) {
        symbolsIndexed += preparedFile.symbolRows.length;
        filesIndexed += 1;
      }
    }

    const repoSymbolMap = preparedFiles.length > 0
      ? new RepoSymbolMap(await storage.listSymbols(repoId))
      : null;
    const allEdges: EdgeRow[] = [];

    if (preparedFiles.length > 0) {
      this.logStage("edge extract", `${preparedFiles.length} files`);
    }
    for (const preparedFile of preparedFiles) {
      const edgeExtractor = new EdgeExtractor({
        repoId,
        filePath: preparedFile.filePath,
        parsedSymbols: preparedFile.parsedSymbols,
        symbolRows: preparedFile.symbolRows,
        storage,
        repoSymbolMap: repoSymbolMap ?? undefined,
        extensions: extensions ?? parser.supportedExtensions,
      });
      const edges = await edgeExtractor.extractEdges();
      allEdges.push(...edges);
    }

    if (allEdges.length > 0) {
      this.logStage("write edges", `${allEdges.length} rows`);
      await storage.upsertEdges(allEdges);
    }

    this.logStage(
      "done",
      `files=${filesIndexed}, skipped=${filesSkipped}, symbols=${symbolsIndexed}, edges=${allEdges.length}`
    );
    return { filesIndexed, filesSkipped, symbolsIndexed };
  }

  private async validateEmbeddingCompatibility(storage: IndexStorage, repoId: string): Promise<void> {
    const metadata = await storage.getEmbeddingMetadata(repoId);
    if (!metadata || this.opts.embedder.modelId === "noop") {
      return;
    }

    const configuredDimensions = this.opts.embedder.dimensions;
    if (
      metadata.modelId !== this.opts.embedder.modelId ||
      (configuredDimensions > 0 && metadata.dimensions !== configuredDimensions)
    ) {
      throw new Error(
        `Embedding dimension mismatch: existing index uses ${metadata.dimensions}-dim vectors from ${metadata.modelId}, but current config uses ${configuredDimensions || "unknown"}-dim vectors from ${this.opts.embedder.modelId}. Rebuild the index with a fresh storage path or delete the existing LanceDB directory and reindex.`
      );
    }
  }

  private async validateEmbeddingDimensions(
    storage: IndexStorage,
    repoId: string,
    dimensions: number,
    modelId: string
  ): Promise<void> {
    if (dimensions <= 0) {
      throw new Error(`Embedder ${modelId} returned an empty embedding vector.`);
    }

    const metadata = await storage.getEmbeddingMetadata(repoId);
    if (!metadata) {
      return;
    }

    if (metadata.modelId !== modelId || metadata.dimensions !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch: existing index uses ${metadata.dimensions}-dim vectors from ${metadata.modelId}, but current config uses ${dimensions}-dim vectors from ${modelId}. Rebuild the index with a fresh storage path or delete the existing LanceDB directory and reindex.`
      );
    }
  }

  private logStage(label: string, message: string): void {
    process.stderr.write(`  ${label.padEnd(13)}: ${message}\n`);
  }

  private logEmbedBackend(embedder: Embedder): void {
    if (this.embedBackendLogged || embedder.modelId === "noop") {
      return;
    }

    this.logStage("embed backend", `${embedder.constructor.name} (${embedder.modelId})`);
    this.embedBackendLogged = true;
  }

  private logEmbeddingProgress(progress: EmbeddingProgress): void {
    const parts: string[] = [];
    if (progress.batchIndex && progress.totalBatches) {
      parts.push(`batch ${progress.batchIndex}/${progress.totalBatches}`);
    }
    if (progress.completedTexts !== undefined && progress.totalTexts !== undefined) {
      parts.push(`${progress.completedTexts}/${progress.totalTexts} texts`);
    }
    this.logStage("embed progress", parts.join(", ") || "running");
  }

  private startEmbedHeartbeat(filePath: string, texts: number): NodeJS.Timeout {
    return setInterval(() => {
      this.logStage("embed wait", `still embedding ${filePath} (${texts} symbols)`);
    }, 30_000);
  }

  private buildSymbolRows(
    filePath: string,
    parsedSymbols: ParsedSymbol[],
    content: string,
    fileHash: string,
    gitCommit: string | null
  ): CodeSymbolRow[] {
    const now = Date.now();
    const counters = new Map<string, number>();
    const symbolRows = parsedSymbols.map((sym) => {
      const occurrence = incrementCounter(counters, `${sym.symbolKind}:${sym.symbolName}`);
      return {
        id: buildSymbolId(this.opts.repoId, filePath, sym.symbolKind, sym.symbolName, occurrence),
        repoId: this.opts.repoId,
        filePath,
        language: this.detectLanguage(filePath),
        symbolName: sym.symbolName,
        symbolKind: sym.symbolKind,
        startLine: sym.startLine,
        endLine: sym.endLine,
        hash: contentHash(sym.rawText),
        parserVersion: this.opts.parser.parserVersion,
        embeddingModelId: this.opts.embedder.modelId !== "noop" ? this.opts.embedder.modelId : null,
        rawText: sym.rawText,
        imports: sym.imports,
        exports: sym.exports,
        calls: sym.calls,
        isTest: this.isTestFile(filePath),
        tags: [] as string[],
        modifiedAt: now,
        gitCommit,
        embedding: null,
      } satisfies CodeSymbolRow;
    });

    symbolRows.unshift({
      id: buildSymbolId(this.opts.repoId, filePath, "file_summary", filePath, 1),
      repoId: this.opts.repoId,
      filePath,
      language: this.detectLanguage(filePath),
      symbolName: filePath,
      symbolKind: "file_summary",
      startLine: 1,
      endLine: Math.max(content.split("\n").length, 1),
      hash: fileHash,
      parserVersion: this.opts.parser.parserVersion,
      embeddingModelId: null,
      rawText: "",
      imports: [] as string[],
      exports: [] as string[],
      calls: [] as string[],
      isTest: this.isTestFile(filePath),
      tags: ["generated:file-summary"] as string[],
      modifiedAt: now,
      gitCommit,
      embedding: null,
    } satisfies CodeSymbolRow);

    return symbolRows;
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

function incrementCounter(counters: Map<string, number>, key: string): number {
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}
