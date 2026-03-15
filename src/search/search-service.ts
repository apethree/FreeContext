import type {
  IndexStorage,
  CodeSymbolRow,
  SymbolSearchQuery,
  SymbolKind,
} from "../types/index.js";

export interface SearchOptions {
  text?: string;
  filePath?: string;
  symbolKind?: SymbolKind;
  limit?: number;
}

export class SearchService {
  constructor(private storage: IndexStorage) {}

  async search(opts: SearchOptions): Promise<CodeSymbolRow[]> {
    const query: SymbolSearchQuery = {
      text: opts.text,
      filePath: opts.filePath,
      symbolKind: opts.symbolKind,
      limit: opts.limit ?? 50,
    };
    return this.storage.searchSymbols(query);
  }

  async findSymbol(
    name: string,
    kind?: SymbolKind
  ): Promise<CodeSymbolRow[]> {
    return this.search({ text: name, symbolKind: kind });
  }

  async listFileSymbols(filePath: string, repoId: string): Promise<CodeSymbolRow[]> {
    return this.storage.getSymbolsByFile(repoId, filePath);
  }
}
