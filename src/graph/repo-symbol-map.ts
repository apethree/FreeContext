import type { CodeSymbolRow } from "../types/index.js";

export class RepoSymbolMap {
  private byName = new Map<string, CodeSymbolRow[]>();

  constructor(symbols: CodeSymbolRow[]) {
    for (const symbol of symbols) {
      if (["import", "export", "file_summary"].includes(symbol.symbolKind)) {
        continue;
      }

      const bucket = this.byName.get(symbol.symbolName) ?? [];
      bucket.push(symbol);
      this.byName.set(symbol.symbolName, bucket);
    }
  }

  findExact(name: string): CodeSymbolRow | null {
    return selectSingleCandidate(this.byName.get(name) ?? []);
  }

  findReference(reference: string): CodeSymbolRow | null {
    for (const candidateName of normalizeReferenceNames(reference)) {
      const match = this.findExact(candidateName);
      if (match) {
        return match;
      }
    }

    return null;
  }
}

function selectSingleCandidate(symbols: CodeSymbolRow[]): CodeSymbolRow | null {
  const concrete = symbols.filter((symbol) => !symbol.isTest);
  if (concrete.length === 1) {
    return concrete[0] ?? null;
  }
  if (symbols.length === 1) {
    return symbols[0] ?? null;
  }
  return null;
}

function normalizeReferenceNames(reference: string): string[] {
  const normalized = reference.trim().replace(/\?\./g, ".").replace(/^this\./, "");
  const lastSegment = normalized.includes(".") ? normalized.split(".").at(-1) : normalized;
  return [...new Set([reference.trim(), normalized, lastSegment].filter(Boolean) as string[])];
}
