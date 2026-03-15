export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type_alias"
  | "variable"
  | "import"
  | "export"
  | "file_summary";

export type EdgeKind = "calls" | "imports" | "implements" | "extends";

export interface CodeSymbolRow {
  id: string;
  repoId: string;
  filePath: string;
  language: string;
  symbolName: string;
  symbolKind: SymbolKind;
  startLine: number;
  endLine: number;
  hash: string;
  parserVersion: string;
  embeddingModelId: string | null;
  rawText: string;
  imports: string[];
  exports: string[];
  calls: string[];
  isTest: boolean;
  tags: string[];
  modifiedAt: number;
  gitCommit: string | null;
  embedding: number[] | null;
}

export interface EdgeRow {
  id: string;
  repoId: string;
  fromSymbolId: string;
  toSymbolId: string;
  edgeKind: EdgeKind;
  filePath: string;
}

export interface ParsedSymbol {
  symbolName: string;
  symbolKind: SymbolKind;
  startLine: number;
  endLine: number;
  rawText: string;
  imports: string[];
  exports: string[];
  calls: string[];
}

export interface FileProvider {
  listFiles(root: string, extensions?: string[]): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ mtimeMs: number } | null>;
}

export interface LanguageParser {
  readonly supportedExtensions: string[];
  readonly parserVersion: string;
  parseFile(filePath: string, content: string): ParsedSymbol[];
}

export interface Embedder {
  embedTexts(texts: string[]): Promise<number[][]>;
  readonly modelId: string;
  readonly dimensions: number;
}

export interface SymbolSearchQuery {
  text?: string;
  filePath?: string;
  symbolKind?: SymbolKind;
  embedding?: number[];
  limit?: number;
}

export interface IndexStorage {
  upsertSymbols(symbols: CodeSymbolRow[]): Promise<void>;
  upsertEdges(edges: EdgeRow[]): Promise<void>;
  searchSymbols(query: SymbolSearchQuery): Promise<CodeSymbolRow[]>;
  getSymbolById(id: string): Promise<CodeSymbolRow | null>;
  getSymbolsByFile(repoId: string, filePath: string): Promise<CodeSymbolRow[]>;
  getEdgesFrom(symbolId: string): Promise<EdgeRow[]>;
  getEdgesTo(symbolId: string): Promise<EdgeRow[]>;
  deleteSymbolsByFile(repoId: string, filePath: string): Promise<void>;
}

export interface ChangeTracker {
  getChangedFiles(since?: string): Promise<string[]>;
  getCurrentRevision(): Promise<string>;
}

export interface CodeIntelConfig {
  repoId: string;
  rootPath: string;
  extensions: string[];
  ignore: string[];
  storage: "memory" | "lancedb";
  storagePath?: string;
  embed: boolean;
}

export const DEFAULT_CONFIG: Omit<CodeIntelConfig, "repoId" | "rootPath"> = {
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignore: ["node_modules", "dist", ".git", "build", "coverage", ".next"],
  storage: "memory",
  embed: false,
};
