import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { connect, Index, type Connection, type Table } from "@lancedb/lancedb";
import type {
  CodeSymbolRow,
  EmbeddingMetadata,
  EdgeRow,
  IndexStorage,
  PathSearchQuery,
  SymbolSearchQuery,
} from "../types/index.js";

interface LanceDbStorageOptions {
  path: string;
  vectorDimensions?: number;
}

interface LanceSymbolRow
  extends Omit<
    CodeSymbolRow,
    "embedding" | "imports" | "exports" | "calls" | "tags" | "embeddingModelId" | "gitCommit"
  > {
  importsJson: string;
  exportsJson: string;
  callsJson: string;
  tagsJson: string;
  embeddingModelIdValue: string;
  gitCommitValue: string;
  embedding?: number[];
  hasEmbedding: boolean;
  searchText: string;
}

export class LanceDbStorage implements IndexStorage {
  private connectionPromise: Promise<Connection> | null = null;
  private symbolTable: Table | null = null;
  private edgeTable: Table | null = null;
  private symbolTableInitPromise: Promise<Table | null> | null = null;
  private edgeTableInitPromise: Promise<Table | null> | null = null;
  private vectorDimensions: number;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private options: LanceDbStorageOptions) {
    this.vectorDimensions = options.vectorDimensions ?? 0;
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async upsertSymbols(symbols: CodeSymbolRow[]): Promise<void> {
    return this.enqueueWrite(() => this._upsertSymbols(symbols));
  }

  async upsertEdges(edges: EdgeRow[]): Promise<void> {
    return this.enqueueWrite(() => this._upsertEdges(edges));
  }

  private async _upsertSymbols(symbols: CodeSymbolRow[]): Promise<void> {
    if (symbols.length === 0) {
      return;
    }

    const { table, created } = await this.getOrCreateSymbolTable(symbols);
    await this.ensureSymbolTableCompatibility(
      table,
      symbols.some((symbol) => symbol.embedding !== null)
    );
    if (!created) {
      await this.deleteRowsById(table, symbols.map((symbol) => symbol.id));
      await table.add(
        symbols.map((symbol) => this.toLanceSymbolRow(symbol)) as unknown as Record<string, unknown>[]
      );
      await this.ensureSymbolIndices(table, symbols.some((symbol) => symbol.embedding !== null));
    }
  }

  private async _upsertEdges(edges: EdgeRow[]): Promise<void> {
    if (edges.length === 0) {
      return;
    }

    const { table, created } = await this.getOrCreateEdgeTable(edges);
    if (!created) {
      await this.deleteRowsById(table, edges.map((edge) => edge.id));
      await table.add(edges as unknown as Record<string, unknown>[]);
      await this.ensureEdgeIndices(table);
    }
  }

  async searchSymbols(query: SymbolSearchQuery): Promise<CodeSymbolRow[]> {
    const table = await this.getSymbolTable();
    if (!table) {
      return [];
    }

    const mode = query.mode ?? "fulltext";
    const limit = query.limit ?? 50;

    if (mode === "semantic" || mode === "hybrid") {
      if (!query.embedding || query.embedding.length === 0) {
        throw new Error("Semantic and hybrid search require a query embedding.");
      }
    }

    if (mode === "semantic") {
      return this.vectorSearch(table, query, limit);
    }

    if (mode === "hybrid") {
      const [vectorResults, textResults] = await Promise.all([
        this.vectorSearch(table, query, limit),
        this.fullTextSearch(table, query, limit),
      ]);
      return this.reciprocalRankFusion(vectorResults, textResults, limit);
    }

    return this.fullTextSearch(table, query, limit);
  }

  async searchPaths(query: PathSearchQuery): Promise<string[]> {
    const table = await this.getSymbolTable();
    if (!table) {
      return [];
    }

    const rows = await this.scanRows(table, query.repoId ? `repoId = ${sqlString(query.repoId)}` : undefined);
    return [...new Set(
      rows
        .map((row) => row.filePath)
        .filter((filePath) => matchesPathQuery(filePath, query))
    )]
      .sort()
      .slice(0, query.limit ?? 50);
  }

  async listSymbols(repoId: string): Promise<CodeSymbolRow[]> {
    const table = await this.getSymbolTable();
    if (!table) {
      return [];
    }

    const rows = await this.scanRows(
      table,
      `repoId = ${sqlString(repoId)} AND symbolKind != ${sqlString("file_summary")}`
    );
    return rows.map((row) => this.fromLanceSymbolRow(row));
  }

  async getSymbolById(id: string): Promise<CodeSymbolRow | null> {
    const table = await this.getSymbolTable();
    if (!table) {
      return null;
    }

    const rows = await table
      .query()
      .where(`id = ${sqlString(id)}`)
      .limit(1)
      .toArray();

    return rows.length > 0 ? this.fromLanceSymbolRow(rows[0] as LanceSymbolRow) : null;
  }

  async getSymbolsByFile(
    repoId: string,
    filePath: string
  ): Promise<CodeSymbolRow[]> {
    const table = await this.getSymbolTable();
    if (!table) {
      return [];
    }

    const rows = await table
      .query()
      .where(
        `repoId = ${sqlString(repoId)} AND filePath = ${sqlString(filePath)}`
      )
      .toArray();

    return rows.map((row) => this.fromLanceSymbolRow(row as LanceSymbolRow));
  }

  async getEdgesFrom(symbolId: string): Promise<EdgeRow[]> {
    const table = await this.getEdgeTable();
    if (!table) {
      return [];
    }

    const rows = await table
      .query()
      .where(`fromSymbolId = ${sqlString(symbolId)}`)
      .toArray();

    return rows as EdgeRow[];
  }

  async getEdgesTo(symbolId: string): Promise<EdgeRow[]> {
    const table = await this.getEdgeTable();
    if (!table) {
      return [];
    }

    const rows = await table
      .query()
      .where(`toSymbolId = ${sqlString(symbolId)}`)
      .toArray();

    return rows as EdgeRow[];
  }

  async deleteSymbolsByFile(repoId: string, filePath: string): Promise<void> {
    return this.enqueueWrite(() => this._deleteSymbolsByFile(repoId, filePath));
  }

  private async _deleteSymbolsByFile(repoId: string, filePath: string): Promise<void> {
    const symbolTable = await this.getSymbolTable();
    if (symbolTable) {
      await symbolTable.delete(
        `repoId = ${sqlString(repoId)} AND filePath = ${sqlString(filePath)}`
      );
    }

    const edgeTable = await this.getEdgeTable();
    if (edgeTable) {
      await edgeTable.delete(
        `repoId = ${sqlString(repoId)} AND filePath = ${sqlString(filePath)}`
      );
    }
  }

  async deleteSymbolsByFiles(repoId: string, filePaths: string[]): Promise<void> {
    const uniquePaths = [...new Set(filePaths)];
    if (uniquePaths.length === 0) {
      return;
    }

    const symbolTable = await this.getSymbolTable();
    if (symbolTable) {
      await this.deleteRowsByPredicateChunks(
        symbolTable,
        uniquePaths.map((filePath) => `repoId = ${sqlString(repoId)} AND filePath = ${sqlString(filePath)}`)
      );
    }

    const edgeTable = await this.getEdgeTable();
    if (edgeTable) {
      await this.deleteRowsByPredicateChunks(
        edgeTable,
        uniquePaths.map((filePath) => `repoId = ${sqlString(repoId)} AND filePath = ${sqlString(filePath)}`)
      );
    }
  }

  async optimize(): Promise<void> {
    const symbolTable = await this.getSymbolTable();
    if (symbolTable) {
      await symbolTable.optimize({ deleteUnverified: false });
    }

    const edgeTable = await this.getEdgeTable();
    if (edgeTable) {
      await edgeTable.optimize({ deleteUnverified: false });
    }
  }

  async getEmbeddingMetadata(repoId: string): Promise<EmbeddingMetadata | null> {
    const table = await this.getSymbolTable();
    if (!table) {
      return null;
    }

    const rows = await table
      .query()
      .where(
        `repoId = ${sqlString(repoId)} AND hasEmbedding = true AND embeddingModelIdValue != ${sqlString("")}`
      )
      .limit(1)
      .toArray();

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as LanceSymbolRow;
    const embedding = normalizeEmbedding(row.embedding);
    if (!embedding || embedding.length === 0 || !row.embeddingModelIdValue) {
      return null;
    }

    return {
      modelId: row.embeddingModelIdValue,
      dimensions: embedding.length,
    };
  }

  private async fullTextSearch(
    table: Table,
    query: SymbolSearchQuery,
    limit: number
  ): Promise<CodeSymbolRow[]> {
    const filter = this.baseFilter(query);

    if (query.text) {
      try {
        let builder = table.search(query.text, "fts", "searchText");
        if (filter) {
          builder = builder.where(filter);
        }
        const rows = await builder.limit(limit).toArray();
        const matches = dedupeById(
          rows
            .map((row) => this.fromLanceSymbolRow(row as LanceSymbolRow))
            .filter((row) => this.matchesCodeSymbol(row, query))
        ).slice(0, limit);
        if (matches.length > 0) {
          return matches;
        }
      } catch {
        // FTS index may not exist yet on a fresh table; fall back to scan + filter.
      }
    }

    let rows = await this.scanRows(table, filter);
    rows = rows.filter((row) => this.matchesRow(row, query));
    return rows.slice(0, limit).map((row) => this.fromLanceSymbolRow(row));
  }

  private async vectorSearch(
    table: Table,
    query: SymbolSearchQuery,
    limit: number
  ): Promise<CodeSymbolRow[]> {
    const filter = this.baseFilter(query, true);
    let builder = table.search(query.embedding!, "vector");
    if (filter) {
      builder = builder.where(filter);
    }
    builder = builder.limit(limit);
    const rows = await builder.toArray();
    return dedupeById(
      rows
        .map((row) => this.fromLanceSymbolRow(row as LanceSymbolRow))
        .filter((row) => this.matchesMetadata(row, query))
    ).slice(0, limit);
  }

  private reciprocalRankFusion(
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

  private async scanRows(table: Table, filter?: string): Promise<LanceSymbolRow[]> {
    let builder = table.query();
    if (filter) {
      builder = builder.where(filter);
    }
    const rows = await builder.toArray();
    return rows as LanceSymbolRow[];
  }

  private matchesRow(row: LanceSymbolRow, query: SymbolSearchQuery): boolean {
    return this.matchesCodeSymbol(this.fromLanceSymbolRow(row), query);
  }

  private matchesMetadata(row: CodeSymbolRow, query: SymbolSearchQuery): boolean {
    if (query.exactSymbolName && row.symbolName !== query.exactSymbolName) {
      return false;
    }

    if (query.filePath && row.filePath !== query.filePath) {
      return false;
    }

    if (query.pathPrefix && !row.filePath.startsWith(query.pathPrefix)) {
      return false;
    }

    if (query.symbolKind && row.symbolKind !== query.symbolKind) {
      return false;
    }

    if (query.repoId && row.repoId !== query.repoId) {
      return false;
    }

    return true;
  }

  private matchesCodeSymbol(row: CodeSymbolRow, query: SymbolSearchQuery): boolean {
    if (query.text) {
      const lower = query.text.toLowerCase();
      const haystack = [
        row.symbolName,
        row.filePath,
        row.symbolKind,
        row.rawText,
        ...row.imports,
        ...row.exports,
        ...row.calls,
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(lower)) {
        return false;
      }
    }

    return this.matchesMetadata(row, query);
  }

  private baseFilter(
    query: Pick<SymbolSearchQuery, "repoId" | "exactSymbolName" | "filePath" | "pathPrefix" | "symbolKind">,
    requireEmbedding = false
  ): string {
    const parts: string[] = [];
    if (query.repoId) {
      parts.push(`repoId = ${sqlString(query.repoId)}`);
    }
    if (query.exactSymbolName) {
      parts.push(`symbolName = ${sqlString(query.exactSymbolName)}`);
    }
    if (query.filePath) {
      parts.push(`filePath = ${sqlString(query.filePath)}`);
    }
    if (query.pathPrefix) {
      parts.push(`filePath LIKE ${sqlString(`${query.pathPrefix}%`)}`);
    }
    if (query.symbolKind) {
      parts.push(`symbolKind = ${sqlString(query.symbolKind)}`);
    } else {
      parts.push(`symbolKind != ${sqlString("file_summary")}`);
    }
    if (requireEmbedding) {
      parts.push("hasEmbedding = true");
    }
    return parts.join(" AND ");
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connectionPromise) {
      this.connectionPromise = (async () => {
        const target = resolve(this.options.path);
        await mkdir(dirname(target), { recursive: true });
        return connect(target);
      })();
    }

    return this.connectionPromise;
  }

  private async getSymbolTable(): Promise<Table | null> {
    while (true) {
      if (this.symbolTable) {
        return this.symbolTable;
      }
      if (this.symbolTableInitPromise) {
        const table = await this.symbolTableInitPromise;
        if (table) {
          return table;
        }
        continue;
      }

      const pendingTable = this.openExistingTable("symbols");
      this.symbolTableInitPromise = pendingTable;
      try {
        const table = await pendingTable;
        if (table) {
          this.symbolTable = table;
        }
        return table;
      } finally {
        if (this.symbolTableInitPromise === pendingTable) {
          this.symbolTableInitPromise = null;
        }
      }
    }
  }

  private async getOrCreateSymbolTable(symbols: CodeSymbolRow[]): Promise<{ table: Table; created: boolean }> {
    while (true) {
      if (this.symbolTable) {
        return { table: this.symbolTable, created: false };
      }
      if (this.symbolTableInitPromise) {
        const table = await this.symbolTableInitPromise;
        if (table) {
          return { table, created: false };
        }
        continue;
      }

      const existingTable = await this.openExistingTable("symbols");
      if (existingTable) {
        this.symbolTable = existingTable;
        return { table: existingTable, created: false };
      }

      const pendingTable = this.createSymbolTable(symbols);
      this.symbolTableInitPromise = pendingTable;
      try {
        const table = await pendingTable;
        this.symbolTable = table;
        return { table, created: true };
      } finally {
        if (this.symbolTableInitPromise === pendingTable) {
          this.symbolTableInitPromise = null;
        }
      }
    }
  }

  private async getEdgeTable(): Promise<Table | null> {
    while (true) {
      if (this.edgeTable) {
        return this.edgeTable;
      }
      if (this.edgeTableInitPromise) {
        const table = await this.edgeTableInitPromise;
        if (table) {
          return table;
        }
        continue;
      }

      const pendingTable = this.openExistingTable("edges");
      this.edgeTableInitPromise = pendingTable;
      try {
        const table = await pendingTable;
        if (table) {
          this.edgeTable = table;
        }
        return table;
      } finally {
        if (this.edgeTableInitPromise === pendingTable) {
          this.edgeTableInitPromise = null;
        }
      }
    }
  }

  private async getOrCreateEdgeTable(edges: EdgeRow[]): Promise<{ table: Table; created: boolean }> {
    while (true) {
      if (this.edgeTable) {
        return { table: this.edgeTable, created: false };
      }
      if (this.edgeTableInitPromise) {
        const table = await this.edgeTableInitPromise;
        if (table) {
          return { table, created: false };
        }
        continue;
      }

      const existingTable = await this.openExistingTable("edges");
      if (existingTable) {
        this.edgeTable = existingTable;
        return { table: existingTable, created: false };
      }

      const pendingTable = this.createEdgeTable(edges);
      this.edgeTableInitPromise = pendingTable;
      try {
        const table = await pendingTable;
        this.edgeTable = table;
        return { table, created: true };
      } finally {
        if (this.edgeTableInitPromise === pendingTable) {
          this.edgeTableInitPromise = null;
        }
      }
    }
  }

  private async openExistingTable(name: "symbols" | "edges"): Promise<Table | null> {
    const conn = await this.getConnection();
    const names = await conn.tableNames();
    if (!names.includes(name)) {
      return null;
    }
    return conn.openTable(name);
  }

  private async createSymbolTable(symbols: CodeSymbolRow[]): Promise<Table> {
    const conn = await this.getConnection();
    const table = await conn.createTable(
      "symbols",
      symbols.map((symbol) => this.toLanceSymbolRow(symbol)) as unknown as Record<string, unknown>[]
    );
    await this.ensureSymbolIndices(table, symbols.some((symbol) => symbol.embedding !== null));
    return table;
  }

  private async createEdgeTable(edges: EdgeRow[]): Promise<Table> {
    const conn = await this.getConnection();
    const table = await conn.createTable(
      "edges",
      edges as unknown as Record<string, unknown>[]
    );
    await this.ensureEdgeIndices(table);
    return table;
  }

  private async ensureSymbolIndices(table: Table, hasEmbeddings: boolean): Promise<void> {
    await this.tryCreateIndex(table, "searchText", Index.fts());
    await this.tryCreateIndex(table, "repoId", Index.btree());
    await this.tryCreateIndex(table, "symbolName", Index.btree());
    await this.tryCreateIndex(table, "filePath", Index.btree());
    await this.tryCreateIndex(table, "symbolKind", Index.bitmap());

    if (hasEmbeddings || this.vectorDimensions > 0) {
      await this.tryCreateIndex(
        table,
        "embedding",
        Index.ivfFlat({ distanceType: "cosine" })
      );
    }
  }

  private async ensureSymbolTableCompatibility(table: Table, hasEmbeddings: boolean): Promise<void> {
    if (!hasEmbeddings) {
      return;
    }

    const schema = await table.schema();
    const fieldNames = new Set(schema.fields.map((field) => field.name));
    const requiredFields = ["embedding", "embeddingModelIdValue", "hasEmbedding"];
    const missingFields = requiredFields.filter((field) => !fieldNames.has(field));

    if (missingFields.length > 0) {
      throw new Error(
        `The existing LanceDB symbols table is missing embedding columns (${missingFields.join(", ")}). This database was likely created before embeddings were enabled. Rebuild the index with a fresh storage path or delete the existing LanceDB directory and reindex.`
      );
    }
  }

  private async ensureEdgeIndices(table: Table): Promise<void> {
    await this.tryCreateIndex(table, "fromSymbolId", Index.btree());
    await this.tryCreateIndex(table, "toSymbolId", Index.btree());
    await this.tryCreateIndex(table, "repoId", Index.btree());
    await this.tryCreateIndex(table, "filePath", Index.btree());
  }

  private async tryCreateIndex(table: Table, column: string, config: Index): Promise<void> {
    try {
      await table.createIndex(column, {
        config,
        replace: false,
        waitTimeoutSeconds: 30,
      });
    } catch {
      // Ignore duplicate or incompatible index creation attempts on repeat writes.
    }
  }

  private async deleteRowsById(table: Table, ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return;
    }

    await this.deleteRowsByPredicateChunks(
      table,
      uniqueIds.map((id) => `id = ${sqlString(id)}`)
    );
  }

  private async deleteRowsByPredicateChunks(table: Table, predicates: string[]): Promise<void> {
    for (const chunk of chunkPredicates(predicates)) {
      await table.delete(chunk.join(" OR "));
    }
  }

  private toLanceSymbolRow(symbol: CodeSymbolRow): LanceSymbolRow {
    const embedding =
      symbol.embedding ??
      (this.vectorDimensions > 0 ? new Array(this.vectorDimensions).fill(0) : undefined);

    return {
      id: symbol.id,
      repoId: symbol.repoId,
      filePath: symbol.filePath,
      language: symbol.language,
      symbolName: symbol.symbolName,
      symbolKind: symbol.symbolKind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      hash: symbol.hash,
      parserVersion: symbol.parserVersion,
      embeddingModelIdValue: symbol.embeddingModelId ?? "",
      rawText: symbol.rawText,
      importsJson: JSON.stringify(symbol.imports),
      exportsJson: JSON.stringify(symbol.exports),
      callsJson: JSON.stringify(symbol.calls),
      isTest: symbol.isTest,
      tagsJson: JSON.stringify(symbol.tags),
      modifiedAt: symbol.modifiedAt,
      gitCommitValue: symbol.gitCommit ?? "",
      embedding,
      hasEmbedding: symbol.embedding !== null && symbol.embedding.length > 0,
      searchText: [
        symbol.symbolName,
        symbol.filePath,
        symbol.symbolKind,
        symbol.rawText,
        ...symbol.imports,
        ...symbol.exports,
        ...symbol.calls,
      ].join("\n"),
    };
  }

  private fromLanceSymbolRow(row: LanceSymbolRow): CodeSymbolRow {
    return {
      id: row.id,
      repoId: row.repoId,
      filePath: row.filePath,
      language: row.language,
      symbolName: row.symbolName,
      symbolKind: row.symbolKind,
      startLine: Number(row.startLine),
      endLine: Number(row.endLine),
      hash: row.hash,
      parserVersion: row.parserVersion,
      embeddingModelId: row.embeddingModelIdValue || null,
      rawText: row.rawText,
      imports: parseJsonArray(row.importsJson),
      exports: parseJsonArray(row.exportsJson),
      calls: parseJsonArray(row.callsJson),
      isTest: Boolean(row.isTest),
      tags: parseJsonArray(row.tagsJson),
      modifiedAt: Number(row.modifiedAt),
      gitCommit: row.gitCommitValue || null,
      embedding: row.hasEmbedding ? normalizeEmbedding(row.embedding) : null,
    };
  }
}

function matchesPathQuery(filePath: string, query: PathSearchQuery): boolean {
  if (query.query && !filePath.toLowerCase().includes(query.query.toLowerCase())) {
    return false;
  }

  if (query.pathPrefix && !filePath.startsWith(query.pathPrefix)) {
    return false;
  }

  return true;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function normalizeEmbedding(value: unknown): number[] | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>, (item) => Number(item));
  }

  if (typeof value === "object" && value !== null && "toArray" in value) {
    const arrayValue = (value as { toArray(): unknown[] }).toArray();
    if (arrayValue.length === 1 && Array.isArray(arrayValue[0])) {
      return arrayValue[0].map((item) => Number(item));
    }
    return Array.from(arrayValue as unknown as ArrayLike<unknown>, (item) => Number(item));
  }

  return null;
}

function dedupeById(rows: CodeSymbolRow[]): CodeSymbolRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

export function chunkPredicates(predicates: string[], maxClauseLength = 16_384): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const predicate of predicates) {
    const nextLength = current.length === 0 ? predicate.length : currentLength + 4 + predicate.length;
    if (current.length > 0 && nextLength > maxClauseLength) {
      chunks.push(current);
      current = [predicate];
      currentLength = predicate.length;
      continue;
    }

    current.push(predicate);
    currentLength = nextLength;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
