import type {
  EmbeddingMetadata,
  IndexStorage,
  CodeSymbolRow,
  EdgeRow,
  PathSearchQuery,
  SymbolSearchQuery,
} from "../types/index.js";

export class MemoryStorage implements IndexStorage {
  private symbols = new Map<string, CodeSymbolRow>();
  private edges = new Map<string, EdgeRow>();

  async upsertSymbols(symbols: CodeSymbolRow[]): Promise<void> {
    for (const sym of symbols) {
      this.symbols.set(sym.id, sym);
    }
  }

  async upsertEdges(edges: EdgeRow[]): Promise<void> {
    for (const edge of edges) {
      this.edges.set(edge.id, edge);
    }
  }

  async searchSymbols(query: SymbolSearchQuery): Promise<CodeSymbolRow[]> {
    let results = Array.from(this.symbols.values());

    if (!query.symbolKind) {
      results = results.filter((s) => s.symbolKind !== "file_summary");
    }

    if (query.repoId) {
      results = results.filter((s) => s.repoId === query.repoId);
    }

    if (query.exactSymbolName) {
      results = results.filter((s) => s.symbolName === query.exactSymbolName);
    }

    if (query.text) {
      const lower = query.text.toLowerCase();
      results = results.filter(
        (s) =>
          s.symbolName.toLowerCase().includes(lower) ||
          s.filePath.toLowerCase().includes(lower)
      );
    }

    if (query.filePath) {
      results = results.filter((s) => s.filePath === query.filePath);
    }

    if (query.pathPrefix) {
      results = results.filter((s) => s.filePath.startsWith(query.pathPrefix!));
    }

    if (query.symbolKind) {
      results = results.filter((s) => s.symbolKind === query.symbolKind);
    }

    const limit = query.limit ?? 50;
    return results.slice(0, limit);
  }

  async searchPaths(query: PathSearchQuery): Promise<string[]> {
    let rows = Array.from(this.symbols.values());

    if (query.repoId) {
      rows = rows.filter((symbol) => symbol.repoId === query.repoId);
    }

    let paths = rows.map((symbol) => symbol.filePath);

    if (query.query) {
      const lower = query.query.toLowerCase();
      paths = paths.filter((filePath) => filePath.toLowerCase().includes(lower));
    }

    if (query.pathPrefix) {
      paths = paths.filter((filePath) => filePath.startsWith(query.pathPrefix!));
    }

    return [...new Set(paths)].sort().slice(0, query.limit ?? 50);
  }

  async listSymbols(repoId: string): Promise<CodeSymbolRow[]> {
    return Array.from(this.symbols.values()).filter(
      (symbol) => symbol.repoId === repoId && symbol.symbolKind !== "file_summary"
    );
  }

  async getSymbolById(id: string): Promise<CodeSymbolRow | null> {
    return this.symbols.get(id) ?? null;
  }

  async getSymbolsByFile(
    repoId: string,
    filePath: string
  ): Promise<CodeSymbolRow[]> {
    return Array.from(this.symbols.values()).filter(
      (s) => s.repoId === repoId && s.filePath === filePath
    );
  }

  async getEdgesFrom(symbolId: string): Promise<EdgeRow[]> {
    return Array.from(this.edges.values()).filter(
      (e) => e.fromSymbolId === symbolId
    );
  }

  async getEdgesTo(symbolId: string): Promise<EdgeRow[]> {
    return Array.from(this.edges.values()).filter(
      (e) => e.toSymbolId === symbolId
    );
  }

  async deleteSymbolsByFile(repoId: string, filePath: string): Promise<void> {
    for (const [id, sym] of this.symbols) {
      if (sym.repoId === repoId && sym.filePath === filePath) {
        this.symbols.delete(id);
      }
    }
    for (const [id, edge] of this.edges) {
      if (edge.filePath === filePath && edge.repoId === repoId) {
        this.edges.delete(id);
      }
    }
  }

  async deleteSymbolsByFiles(repoId: string, filePaths: string[]): Promise<void> {
    const targets = new Set(filePaths);
    if (targets.size === 0) {
      return;
    }

    for (const [id, sym] of this.symbols) {
      if (sym.repoId === repoId && targets.has(sym.filePath)) {
        this.symbols.delete(id);
      }
    }
    for (const [id, edge] of this.edges) {
      if (edge.repoId === repoId && targets.has(edge.filePath)) {
        this.edges.delete(id);
      }
    }
  }

  async getEmbeddingMetadata(repoId: string): Promise<EmbeddingMetadata | null> {
    const symbol = Array.from(this.symbols.values()).find(
      (candidate) =>
        candidate.repoId === repoId &&
        candidate.embeddingModelId !== null &&
        Array.isArray(candidate.embedding) &&
        candidate.embedding.length > 0
    );

    if (!symbol?.embedding || !symbol.embeddingModelId) {
      return null;
    }

    return {
      modelId: symbol.embeddingModelId,
      dimensions: symbol.embedding.length,
    };
  }

  get symbolCount(): number {
    return this.symbols.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }
}
