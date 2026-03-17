// Fixture for edit-evals — LanceDbStorage write queue
// Source: extracted from src/storage/lancedb-storage.ts
// DO NOT import this file in production code.

export class LanceDbStorageWriteQueue {
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async upsertSymbols(symbols: unknown[]): Promise<void> {
    return this.enqueueWrite(() => this._upsertSymbols(symbols));
  }

  async upsertEdges(edges: unknown[]): Promise<void> {
    return this.enqueueWrite(() => this._upsertEdges(edges));
  }

  async deleteSymbolsByFile(repoId: string, filePath: string): Promise<void> {
    return this.enqueueWrite(() => this._deleteSymbolsByFile(repoId, filePath));
  }

  private async _upsertSymbols(_symbols: unknown[]): Promise<void> {}
  private async _upsertEdges(_edges: unknown[]): Promise<void> {}
  private async _deleteSymbolsByFile(_repoId: string, _filePath: string): Promise<void> {}
}
