// Fixture for edit-evals — reciprocalRankFusion
// Source: extracted from src/storage/lancedb-storage.ts
// DO NOT import this file in production code.

import type { CodeSymbolRow } from "../../src/types/index.js";

export function reciprocalRankFusion(
  vectorResults: CodeSymbolRow[],
  textResults: CodeSymbolRow[],
  limit: number
): CodeSymbolRow[] {
  const k = 60;
  const scores = new Map<string, { score: number; row: CodeSymbolRow }>();

  const apply = (rows: CodeSymbolRow[]) => {
    rows.forEach((row, index) => {
      const current = scores.get(row.id) ?? { score: 0, row };
      current.score += 1 / (k + index + 1);
      scores.set(row.id, current);
    });
  };

  apply(vectorResults);
  apply(textResults);

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.row);
}
