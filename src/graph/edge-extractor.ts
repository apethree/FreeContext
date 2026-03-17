import { dirname, join, normalize } from "node:path";
import type {
  CodeSymbolRow,
  EdgeKind,
  EdgeRow,
  IndexStorage,
  ParsedImportBinding,
  ParsedSymbol,
} from "../types/index.js";
import { buildEdgeId } from "../indexer/ids.js";
import { RepoSymbolMap } from "./repo-symbol-map.js";

interface EdgeExtractorOptions {
  repoId: string;
  filePath: string;
  parsedSymbols: ParsedSymbol[];
  symbolRows: CodeSymbolRow[];
  storage: IndexStorage;
  extensions: string[];
  repoSymbolMap?: RepoSymbolMap;
}

export class EdgeExtractor {
  constructor(private options: EdgeExtractorOptions) {}

  async extractEdges(): Promise<EdgeRow[]> {
    const rowEntries = this.options.symbolRows.filter((symbol) => symbol.symbolKind !== "file_summary");
    const localSymbols = rowEntries.filter((symbol) =>
      !["import", "export", "file_summary"].includes(symbol.symbolKind)
    );
    const localSymbolsByName = groupByName(localSymbols);
    const importBindings = this.collectImportBindings();
    const edges: EdgeRow[] = [];

    for (let index = 0; index < rowEntries.length; index++) {
      const row = rowEntries[index]!;
      const parsed = this.options.parsedSymbols[index];
      if (!parsed) {
        continue;
      }

      if (row.symbolKind === "import") {
        const importEdges = await this.extractImportEdges(row, parsed);
        edges.push(...importEdges);
        continue;
      }

      const edgeSpecs: Array<{ kind: EdgeKind; refs: string[] }> = [
        { kind: "calls", refs: parsed.calls },
        { kind: "extends", refs: parsed.extendsTypes },
        { kind: "implements", refs: parsed.implementsTypes },
      ];

      for (const edgeSpec of edgeSpecs) {
        for (const ref of edgeSpec.refs) {
          const target = await this.resolveReference(ref, localSymbolsByName, importBindings);
          if (!target) {
            continue;
          }
          edges.push(
            createEdge({
              repoId: this.options.repoId,
              filePath: this.options.filePath,
              fromSymbolId: row.id,
              toSymbolId: target.id,
              edgeKind: edgeSpec.kind,
            })
          );
        }
      }
    }

    return dedupeEdges(edges);
  }

  private collectImportBindings(): Map<string, ParsedImportBinding> {
    const bindings = new Map<string, ParsedImportBinding>();

    for (const parsed of this.options.parsedSymbols) {
      for (const binding of parsed.importBindings) {
        bindings.set(binding.localName, binding);
      }
    }

    return bindings;
  }

  private async extractImportEdges(row: CodeSymbolRow, parsed: ParsedSymbol): Promise<EdgeRow[]> {
    const edges: EdgeRow[] = [];
    const bindings = parsed.importBindings;

    if (bindings.length === 0) {
      const target = await this.resolveImportFile(parsed.imports[0]);
      if (target) {
        edges.push(
          createEdge({
            repoId: this.options.repoId,
            filePath: this.options.filePath,
            fromSymbolId: row.id,
            toSymbolId: target.id,
            edgeKind: "imports",
          })
        );
      }
      return edges;
    }

    for (const binding of bindings) {
      const target = await this.resolveImportedBinding(binding);
      if (!target) {
        continue;
      }
      edges.push(
        createEdge({
          repoId: this.options.repoId,
          filePath: this.options.filePath,
          fromSymbolId: row.id,
          toSymbolId: target.id,
          edgeKind: "imports",
        })
      );
    }

    return edges;
  }

  private async resolveReference(
    reference: string,
    localSymbolsByName: Map<string, CodeSymbolRow[]>,
    importBindings: Map<string, ParsedImportBinding>
  ): Promise<CodeSymbolRow | null> {
    for (const candidateName of normalizeReferenceNames(reference)) {
      const localTarget = selectSingleCandidate(localSymbolsByName.get(candidateName) ?? []);
      if (localTarget) {
        return localTarget;
      }

      const binding = importBindings.get(candidateName);
      if (binding) {
        const importedTarget = await this.resolveImportedBinding(binding);
        if (importedTarget) {
          return importedTarget;
        }
      }
    }

    for (const candidateName of normalizeReferenceNames(reference)) {
      const repoTarget = await this.resolveRepoSymbol(candidateName);
      if (repoTarget) {
        return repoTarget;
      }
    }

    return null;
  }

  private async resolveImportedBinding(binding: ParsedImportBinding): Promise<CodeSymbolRow | null> {
    const targetFile = resolveModuleSpecifier(
      this.options.filePath,
      binding.source,
      this.options.extensions
    );
    if (!targetFile) {
      return null;
    }

    const symbols = await this.options.storage.getSymbolsByFile(this.options.repoId, targetFile);
    if (symbols.length === 0) {
      return null;
    }

    const concreteSymbols = symbols.filter((symbol) =>
      !["import", "export", "file_summary"].includes(symbol.symbolKind)
    );

    if (binding.importedName === "*") {
      return symbols.find((symbol) => symbol.symbolKind === "file_summary") ?? null;
    }

    if (binding.importedName === "default") {
      const defaultTarget = selectSingleCandidate(
        concreteSymbols.filter((symbol) => symbol.exports.includes("default"))
      );
      if (defaultTarget) {
        return defaultTarget;
      }

      const exportedTargets = concreteSymbols.filter((symbol) => symbol.exports.length > 0);
      if (exportedTargets.length === 1) {
        return exportedTargets[0] ?? null;
      }
    }

    const directMatch = selectSingleCandidate(
      concreteSymbols.filter(
        (symbol) =>
          symbol.symbolName === binding.importedName ||
          symbol.exports.includes(binding.importedName)
      )
    );
    if (directMatch) {
      return directMatch;
    }

    const localAliasMatch = selectSingleCandidate(
      concreteSymbols.filter((symbol) => symbol.symbolName === binding.localName)
    );
    if (localAliasMatch) {
      return localAliasMatch;
    }

    return symbols.find((symbol) => symbol.symbolKind === "file_summary") ?? null;
  }

  private async resolveImportFile(source?: string): Promise<CodeSymbolRow | null> {
    if (!source) {
      return null;
    }

    const targetFile = resolveModuleSpecifier(
      this.options.filePath,
      source,
      this.options.extensions
    );
    if (!targetFile) {
      return null;
    }

    const symbols = await this.options.storage.getSymbolsByFile(this.options.repoId, targetFile);
    return symbols.find((symbol) => symbol.symbolKind === "file_summary") ?? null;
  }

  private async resolveRepoSymbol(name: string): Promise<CodeSymbolRow | null> {
    if (this.options.repoSymbolMap) {
      return this.options.repoSymbolMap.findExact(name);
    }

    const results = await this.options.storage.searchSymbols({
      repoId: this.options.repoId,
      exactSymbolName: name,
      limit: 200,
    });

    return selectSingleCandidate(
      results.filter(
        (symbol) =>
          symbol.symbolName === name &&
          !["import", "export", "file_summary"].includes(symbol.symbolKind)
      )
    );
  }
}

function createEdge(edge: Omit<EdgeRow, "id">): EdgeRow {
  return {
    ...edge,
    id: buildEdgeId(edge),
  };
}

function dedupeEdges(edges: EdgeRow[]): EdgeRow[] {
  const unique = new Map<string, EdgeRow>();
  for (const edge of edges) {
    unique.set(edge.id, edge);
  }
  return Array.from(unique.values());
}

function groupByName(symbols: CodeSymbolRow[]): Map<string, CodeSymbolRow[]> {
  const grouped = new Map<string, CodeSymbolRow[]>();
  for (const symbol of symbols) {
    const bucket = grouped.get(symbol.symbolName) ?? [];
    bucket.push(symbol);
    grouped.set(symbol.symbolName, bucket);
  }
  return grouped;
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

function resolveModuleSpecifier(
  fromFilePath: string,
  source: string,
  extensions: string[]
): string | null {
  if (!source.startsWith(".")) {
    return null;
  }

  const fromDir = dirname(fromFilePath);
  const base = normalize(join(fromDir, source));
  const candidates = new Set<string>();
  const strippedBase = stripSourceExtension(base);
  const hasExplicitSourceExtension = strippedBase !== base;

  if (hasExplicitSourceExtension) {
    for (const extension of extensions) {
      candidates.add(`${strippedBase}${extension}`);
    }
    candidates.add(base);
  } else {
    candidates.add(base);
    for (const extension of extensions) {
      candidates.add(`${base}${extension}`);
      candidates.add(join(base, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replace(/\\/g, "/");
    if (normalizedCandidate.endsWith(".ts") ||
        normalizedCandidate.endsWith(".tsx") ||
        normalizedCandidate.endsWith(".js") ||
        normalizedCandidate.endsWith(".jsx")) {
      return normalizedCandidate;
    }
  }

  return null;
}

function stripSourceExtension(value: string): string {
  for (const extension of [".tsx", ".ts", ".jsx", ".js", ".mts", ".cts", ".mjs", ".cjs"]) {
    if (value.endsWith(extension)) {
      return value.slice(0, -extension.length);
    }
  }
  return value;
}
