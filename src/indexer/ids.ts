import type { CodeSymbolRow, EdgeRow } from "../types/index.js";
import { contentHash } from "../parser/hash.js";

export function buildSymbolId(
  repoId: string,
  filePath: string,
  symbolKind: CodeSymbolRow["symbolKind"],
  symbolName: string,
  occurrence: number
): string {
  return `sym_${contentHash(`${repoId}:${filePath}:${symbolKind}:${symbolName}:${occurrence}`)}`;
}

export function buildEdgeId(edge: Omit<EdgeRow, "id">): string {
  return `edge_${contentHash(
    `${edge.repoId}:${edge.filePath}:${edge.fromSymbolId}:${edge.toSymbolId}:${edge.edgeKind}`
  )}`;
}
