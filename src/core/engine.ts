import { randomUUID } from "node:crypto";
import type {
  CodeIntelConfig,
  CodeSymbolRow,
  IndexStorage,
  Embedder,
  FileProvider,
  LanguageParser,
} from "../types/index.js";
import { DEFAULT_CONFIG } from "../types/index.js";
import { MemoryStorage } from "../storage/memory-storage.js";
import { TreeSitterParser } from "../parser/ts-parser.js";
import { NoopEmbedder } from "../embeddings/noop-embedder.js";
import { Indexer } from "../indexer/indexer.js";
import { NodeFileProvider } from "../indexer/node-file-provider.js";
import { SearchService } from "../search/search-service.js";

export class CodeIntelEngine {
  readonly config: CodeIntelConfig;
  readonly storage: IndexStorage;
  readonly parser: LanguageParser;
  readonly embedder: Embedder;
  readonly fileProvider: FileProvider;
  readonly search: SearchService;

  constructor(config: Partial<CodeIntelConfig> & { rootPath: string }) {
    this.config = {
      repoId: config.repoId ?? randomUUID(),
      rootPath: config.rootPath,
      extensions: config.extensions ?? DEFAULT_CONFIG.extensions,
      ignore: config.ignore ?? DEFAULT_CONFIG.ignore,
      storage: config.storage ?? DEFAULT_CONFIG.storage,
      storagePath: config.storagePath,
      embed: config.embed ?? DEFAULT_CONFIG.embed,
    };

    this.storage = new MemoryStorage();
    this.parser = new TreeSitterParser();
    this.embedder = new NoopEmbedder();
    this.fileProvider = new NodeFileProvider();
    this.search = new SearchService(this.storage);
  }

  async index(): Promise<{ filesIndexed: number; symbolsIndexed: number }> {
    const indexer = new Indexer({
      repoId: this.config.repoId,
      rootPath: this.config.rootPath,
      fileProvider: this.fileProvider,
      parser: this.parser,
      embedder: this.embedder,
      storage: this.storage,
      extensions: this.config.extensions,
    });
    return indexer.indexAll();
  }

  async searchSymbols(
    text: string,
    limit?: number
  ): Promise<CodeSymbolRow[]> {
    return this.search.search({ text, limit });
  }

  async findSymbol(name: string): Promise<CodeSymbolRow[]> {
    return this.search.findSymbol(name);
  }

  async getSymbol(id: string): Promise<CodeSymbolRow | null> {
    return this.storage.getSymbolById(id);
  }

  async listFileSymbols(filePath: string): Promise<CodeSymbolRow[]> {
    return this.storage.getSymbolsByFile(this.config.repoId, filePath);
  }
}
