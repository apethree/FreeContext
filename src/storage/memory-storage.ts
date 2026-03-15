import type {
  IndexStorage,
  CodeSymbolRow,
  EdgeRow,
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

    if (query.symbolKind) {
      results = results.filter((s) => s.symbolKind === query.symbolKind);
    }

    const limit = query.limit ?? 50;
    return results.slice(0, limit);
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

  get symbolCount(): number {
    return this.symbols.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }
}
