import type { CodebaseMap, CodeSymbolRow, EdgeRow, IndexStorage } from "../types/index.js";

const CODEBASE_MAP_SYMBOL_LIMIT = 100_000;

export class GraphService {
  constructor(private storage: IndexStorage) {}

  async whoCalls(symbolName: string, repoId: string): Promise<CodeSymbolRow[]> {
    const targets = await this.findExactSymbols(symbolName, repoId);
    if (targets.length === 0) {
      return [];
    }

    const callerIds = new Set<string>();
    for (const target of targets) {
      const edges = await this.storage.getEdgesTo(target.id);
      for (const edge of edges) {
        if (edge.edgeKind === "calls") {
          callerIds.add(edge.fromSymbolId);
        }
      }
    }

    const edgeResults = await this.loadSymbols(Array.from(callerIds));
    if (edgeResults.length > 0) {
      return edgeResults;
    }

    return this.findCallersFromSymbolMetadata(symbolName, repoId);
  }

  async whatDoesThisCall(symbolName: string, repoId: string): Promise<CodeSymbolRow[]> {
    const sources = await this.findExactSymbols(symbolName, repoId);
    if (sources.length === 0) {
      return [];
    }

    const calleeIds = new Set<string>();
    for (const source of sources) {
      const edges = await this.storage.getEdgesFrom(source.id);
      for (const edge of edges) {
        if (edge.edgeKind === "calls") {
          calleeIds.add(edge.toSymbolId);
        }
      }
    }

    const edgeResults = await this.loadSymbols(Array.from(calleeIds));
    if (edgeResults.length > 0) {
      return edgeResults;
    }

    return this.findCalleesFromSymbolMetadata(sources, repoId);
  }

  async codebaseMap(repoId: string): Promise<CodebaseMap> {
    // TODO: Replace this capped scan with paged storage iteration before Phase 4.
    const symbols = await this.storage.searchSymbols({ repoId, limit: CODEBASE_MAP_SYMBOL_LIMIT });
    const symbolIds = symbols
      .filter((symbol) => symbol.symbolKind !== "file_summary")
      .map((symbol) => symbol.id);
    const edges = await this.loadEdges(symbolIds);
    const byKind: CodebaseMap["byKind"] = {};

    for (const symbol of symbols) {
      byKind[symbol.symbolKind] = (byKind[symbol.symbolKind] ?? 0) + 1;
    }

    const files = new Set(symbols.map((symbol) => symbol.filePath));

    return {
      repoId,
      files: files.size,
      symbols: symbols.filter((symbol) => symbol.symbolKind !== "file_summary").length,
      edges: edges.length,
      byKind,
    };
  }

  private async findExactSymbols(symbolName: string, repoId: string): Promise<CodeSymbolRow[]> {
    const results = await this.storage.searchSymbols({
      repoId,
      text: symbolName,
      limit: 500,
    });

    return results.filter(
      (symbol) =>
        symbol.symbolName === symbolName &&
        !["import", "export", "file_summary"].includes(symbol.symbolKind)
    );
  }

  private async findCallersFromSymbolMetadata(
    symbolName: string,
    repoId: string
  ): Promise<CodeSymbolRow[]> {
    const symbols = await this.storage.listSymbols(repoId);
    return dedupeSymbols(
      symbols.filter(
        (symbol) =>
          !["import", "export", "file_summary"].includes(symbol.symbolKind) &&
          referencesName(symbol.calls, symbolName)
      )
    ).sort(sortByLocation);
  }

  private async findCalleesFromSymbolMetadata(
    sources: CodeSymbolRow[],
    repoId: string
  ): Promise<CodeSymbolRow[]> {
    const symbols = await this.storage.listSymbols(repoId);
    const exactByName = new Map<string, CodeSymbolRow[]>();

    for (const symbol of symbols) {
      if (["import", "export", "file_summary"].includes(symbol.symbolKind)) {
        continue;
      }
      const bucket = exactByName.get(symbol.symbolName) ?? [];
      bucket.push(symbol);
      exactByName.set(symbol.symbolName, bucket);
    }

    const matches: CodeSymbolRow[] = [];
    for (const source of sources) {
      for (const reference of source.calls) {
        for (const candidateName of normalizeReferenceNames(reference)) {
          const candidates = exactByName.get(candidateName) ?? [];
          if (candidates.length === 1) {
            matches.push(candidates[0]!);
            break;
          }
        }
      }
    }

    return dedupeSymbols(matches).sort(sortByLocation);
  }

  private async loadSymbols(ids: string[]): Promise<CodeSymbolRow[]> {
    const loaded = await Promise.all(ids.map((id) => this.storage.getSymbolById(id)));
    return dedupeSymbols(
      loaded.filter((symbol): symbol is CodeSymbolRow => symbol !== null)
    ).sort(sortByLocation);
  }

  private async loadEdges(symbolIds: string[]): Promise<EdgeRow[]> {
    const unique = new Map<string, EdgeRow>();

    for (const symbolId of symbolIds) {
      const edges = await this.storage.getEdgesFrom(symbolId);
      for (const edge of edges) {
        unique.set(edge.id, edge);
      }
    }

    return Array.from(unique.values());
  }
}

function dedupeSymbols(symbols: CodeSymbolRow[]): CodeSymbolRow[] {
  const unique = new Map<string, CodeSymbolRow>();
  for (const symbol of symbols) {
    unique.set(symbol.id, symbol);
  }
  return Array.from(unique.values());
}

function sortByLocation(a: CodeSymbolRow, b: CodeSymbolRow): number {
  if (a.filePath !== b.filePath) {
    return a.filePath.localeCompare(b.filePath);
  }
  return a.startLine - b.startLine;
}

function referencesName(references: string[], symbolName: string): boolean {
  return references.some((reference) =>
    normalizeReferenceNames(reference).includes(symbolName)
  );
}

function normalizeReferenceNames(reference: string): string[] {
  const normalized = reference.trim().replace(/\?\./g, ".").replace(/^this\./, "");
  const lastSegment = normalized.includes(".") ? normalized.split(".").at(-1) : normalized;
  return [...new Set([reference.trim(), normalized, lastSegment].filter(Boolean) as string[])];
}
