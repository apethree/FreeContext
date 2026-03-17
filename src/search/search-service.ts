import type {
  IndexStorage,
  CodeSymbolRow,
  PathSearchQuery,
  SymbolSearchQuery,
  SymbolKind,
  SearchMode,
  Embedder,
} from "../types/index.js";

export interface SearchOptions {
  text?: string;
  filePath?: string;
  pathPrefix?: string;
  symbolKind?: SymbolKind;
  repoId?: string;
  mode?: SearchMode;
  limit?: number;
}

export class SearchService {
  constructor(
    private storage: IndexStorage,
    private embedder?: Embedder
  ) {}

  async search(opts: SearchOptions): Promise<CodeSymbolRow[]> {
    let embedding: number[] | undefined;
    if ((opts.mode === "semantic" || opts.mode === "hybrid") && opts.text) {
      if (!this.embedder || this.embedder.modelId === "noop") {
        throw new Error("Semantic and hybrid search require a configured embedder.");
      }
      const vectors = await this.embedder.embedTexts([opts.text]);
      embedding = vectors[0];
      if (!embedding || embedding.length === 0) {
        throw new Error(`Embedder ${this.embedder.modelId} returned an empty query embedding.`);
      }
      if (opts.repoId) {
        await this.validateEmbeddingCompatibility(opts.repoId, embedding.length);
      }
    } else if (opts.mode === "semantic" || opts.mode === "hybrid") {
      throw new Error("Semantic and hybrid search require a text query.");
    }

    const query: SymbolSearchQuery = {
      repoId: opts.repoId,
      text: opts.text,
      filePath: opts.filePath,
      pathPrefix: opts.pathPrefix,
      symbolKind: opts.symbolKind,
      embedding,
      mode: opts.mode,
      limit: opts.limit ?? 50,
    };
    return this.storage.searchSymbols(query);
  }

  async findSymbol(
    name: string,
    kind?: SymbolKind,
    repoId?: string
  ): Promise<CodeSymbolRow[]> {
    return this.storage.searchSymbols({
      repoId,
      exactSymbolName: name,
      symbolKind: kind,
      mode: "fulltext",
      limit: 1000,
    });
  }

  async listFileSymbols(filePath: string, repoId: string): Promise<CodeSymbolRow[]> {
    const symbols = await this.storage.getSymbolsByFile(repoId, filePath);
    return symbols.filter((symbol) => symbol.symbolKind !== "file_summary");
  }

  async searchPaths(query: PathSearchQuery): Promise<string[]> {
    return this.storage.searchPaths({
      repoId: query.repoId,
      query: query.query,
      pathPrefix: query.pathPrefix,
      limit: query.limit ?? 50,
    });
  }

  private async validateEmbeddingCompatibility(
    repoId: string,
    queryDimensions: number
  ): Promise<void> {
    const metadata = await this.storage.getEmbeddingMetadata(repoId);
    if (!metadata || !this.embedder || this.embedder.modelId === "noop") {
      return;
    }

    if (
      metadata.modelId !== this.embedder.modelId ||
      metadata.dimensions !== queryDimensions
    ) {
      throw new Error(
        `Embedding dimension mismatch: existing index uses ${metadata.dimensions}-dim vectors from ${metadata.modelId}, but current config uses ${queryDimensions}-dim vectors from ${this.embedder.modelId}. Rebuild the index with a fresh storage path or delete the existing LanceDB directory and reindex.`
      );
    }
  }
}
