// Fixture for edit-evals — deleteRowsById and its call sites
// Source: extracted from src/storage/lancedb-storage.ts
// DO NOT import this file in production code.

type Table = { delete(filter: string): Promise<void>; add(rows: unknown[]): Promise<void> };

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function _upsertSymbols(table: Table, symbols: Array<{ id: string }>): Promise<void> {
  await deleteRowsById(table, symbols.map((s) => s.id));
  await table.add(symbols);
}

async function _upsertEdges(table: Table, edges: Array<{ id: string }>): Promise<void> {
  await deleteRowsById(table, edges.map((e) => e.id));
  await table.add(edges);
}

async function deleteRowsById(table: Table, ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  const predicates = uniqueIds.map((id) => `id = ${sqlString(id)}`);
  await table.delete(predicates.join(" OR "));
}
