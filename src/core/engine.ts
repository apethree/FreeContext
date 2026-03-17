import { join, resolve } from "node:path";
import type {
  ChangeTracker,
  CodebaseMap,
  CodeIntelConfig,
  CodeSymbolRow,
  IndexStorage,
  IndexResult,
  Embedder,
  FileProvider,
  LanguageParser,
  SymbolKind,
} from "../types/index.js";
import { DEFAULT_CONFIG } from "../types/index.js";
import { MemoryStorage } from "../storage/memory-storage.js";
import { LanceDbStorage } from "../storage/lancedb-storage.js";
import { TreeSitterParser } from "../parser/ts-parser.js";
import { NoopEmbedder } from "../embeddings/noop-embedder.js";
import {
  OllamaEmbedder,
  RemoteEmbedder,
  NvidiaNemotronEmbedder,
  StepFlashEmbedder,
  MinimaxEmbedder,
} from "../embeddings/index.js";
import { Indexer } from "../indexer/indexer.js";
import { NodeFileProvider } from "../indexer/node-file-provider.js";
import { SearchService, type SearchOptions } from "../search/search-service.js";
import { contentHash } from "../parser/hash.js";
import { GraphService } from "../graph/graph-service.js";
import { GitChangeTracker } from "../git/git-change-tracker.js";

export class CodeIntelEngine {
  readonly config: CodeIntelConfig;
  readonly storage: IndexStorage;
  readonly parser: LanguageParser;
  readonly embedder: Embedder;
  readonly fileProvider: FileProvider;
  readonly changeTracker: ChangeTracker;
  readonly search: SearchService;
  readonly graph: GraphService;

  constructor(config: Partial<CodeIntelConfig> & { rootPath: string }) {
    const rootPath = resolve(config.rootPath);
    this.config = {
      repoId: config.repoId ?? defaultRepoId(rootPath),
      rootPath,
      extensions: config.extensions ?? DEFAULT_CONFIG.extensions,
      ignore: config.ignore ?? DEFAULT_CONFIG.ignore,
      storage: config.storage ?? DEFAULT_CONFIG.storage,
      storagePath: config.storagePath ?? defaultStoragePath(rootPath),
      embed: config.embed ?? DEFAULT_CONFIG.embed,
      embedder: config.embedder ?? (config.embed ? "ollama" : DEFAULT_CONFIG.embedder),
      embeddingModelId: config.embeddingModelId,
      embeddingBaseUrl: config.embeddingBaseUrl,
      embeddingDimensions: config.embeddingDimensions,
    };

    this.embedder = createEmbedder(this.config);
    this.storage = createStorage(this.config, this.embedder);
    this.parser = new TreeSitterParser();
    this.fileProvider = new NodeFileProvider();
    this.changeTracker = new GitChangeTracker({ cwd: rootPath });
    this.search = new SearchService(this.storage, this.embedder);
    this.graph = new GraphService(this.storage);
  }

  async index(): Promise<IndexResult> {
    const indexer = new Indexer({
      repoId: this.config.repoId,
      rootPath: this.config.rootPath,
      fileProvider: this.fileProvider,
      parser: this.parser,
      embedder: this.embedder,
      storage: this.storage,
      changeTracker: this.changeTracker,
      extensions: this.config.extensions,
      ignore: this.config.ignore,
    });
    return indexer.indexAll();
  }

  async querySymbols(opts: SearchOptions): Promise<CodeSymbolRow[]> {
    return this.search.search({
      ...opts,
      repoId: this.config.repoId,
    });
  }

  async searchSymbols(
    text: string,
    limit?: number
  ): Promise<CodeSymbolRow[]> {
    return this.search.search({ text, limit, repoId: this.config.repoId });
  }

  async findSymbol(name: string, kind?: SymbolKind): Promise<CodeSymbolRow[]> {
    return this.search.findSymbol(name, kind, this.config.repoId);
  }

  async getSymbol(id: string): Promise<CodeSymbolRow | null> {
    return this.storage.getSymbolById(id);
  }

  async listFileSymbols(filePath: string): Promise<CodeSymbolRow[]> {
    const symbols = await this.storage.getSymbolsByFile(this.config.repoId, filePath);
    return symbols.filter((symbol) => symbol.symbolKind !== "file_summary");
  }

  async searchPaths(query: string, limit?: number, pathPrefix?: string): Promise<string[]> {
    return this.search.searchPaths({
      repoId: this.config.repoId,
      query,
      pathPrefix,
      limit,
    });
  }

  async whoCalls(symbolName: string): Promise<CodeSymbolRow[]> {
    return this.graph.whoCalls(symbolName, this.config.repoId);
  }

  async whatDoesThisCall(symbolName: string): Promise<CodeSymbolRow[]> {
    return this.graph.whatDoesThisCall(symbolName, this.config.repoId);
  }

  async codebaseMap(): Promise<CodebaseMap> {
    return this.graph.codebaseMap(this.config.repoId);
  }

  async recentlyChangedSymbols(since?: string): Promise<CodeSymbolRow[]> {
    const changedFiles = await this.changeTracker.getChangedFiles(since);
    const symbols = await Promise.all(
      changedFiles.map((filePath) => this.listFileSymbols(filePath))
    );
    return symbols.flat().sort((a, b) => {
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath);
      }
      return a.startLine - b.startLine;
    });
  }
}

function defaultRepoId(rootPath: string): string {
  return `repo-${contentHash(rootPath)}`;
}

function defaultStoragePath(rootPath: string): string {
  return join(rootPath, ".free-context", "db");
}

function createEmbedder(config: CodeIntelConfig): Embedder {
  if (!config.embed || config.embedder === "none") {
    return new NoopEmbedder();
  }

  if (config.embedder === "ollama") {
    return new OllamaEmbedder({
      model: config.embeddingModelId,
      host: config.embeddingBaseUrl,
      dimensions: config.embeddingDimensions, // undefined → starts at 0 and self-discovers from first response
    });
  }

  if (config.embedder === "openai_compatible") {
    return new RemoteEmbedder({
      modelId: config.embeddingModelId ?? process.env.OPENAI_COMPATIBLE_MODEL ?? "text-embedding",
      baseUrl:
        config.embeddingBaseUrl ??
        process.env.OPENAI_COMPATIBLE_BASE_URL ??
        "http://127.0.0.1:8080/v1",
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
      apiKeyOptional: true,
      dimensions: config.embeddingDimensions ?? 0,
      batchSize: 128,
    });
  }

  if (config.embedder === "nvidia_nemotron") {
    return new NvidiaNemotronEmbedder(config.embeddingModelId);
  }

  if (config.embedder === "step_3_5_flash") {
    return new StepFlashEmbedder(config.embeddingModelId);
  }

  if (config.embedder === "minimax_2_5") {
    return new MinimaxEmbedder(config.embeddingModelId);
  }

  return new NoopEmbedder();
}

function createStorage(config: CodeIntelConfig, embedder: Embedder): IndexStorage {
  if (config.storage === "lancedb") {
    return new LanceDbStorage({
      path: config.storagePath ?? defaultStoragePath(config.rootPath),
      vectorDimensions: embedder.dimensions,
    });
  }

  return new MemoryStorage();
}
