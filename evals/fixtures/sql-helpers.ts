// Fixture for edit-evals — SQL helper utilities
// Source: extracted from src/storage/lancedb-storage.ts
// DO NOT import this file in production code.

export function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildFilePathFilter(filePaths: string[]): string {
  return filePaths.map((filePath) => `filePath = ${sqlString(filePath)}`).join(" OR ");
}
