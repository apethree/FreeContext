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

export interface ParsedImportBinding {
  source: string;
  importedName: string;
  localName: string;
}

export interface ParsedSymbol {
  symbolName: string;
  symbolKind: SymbolKind;
  startLine: number;
  endLine: number;
  rawText: string;
  imports: string[];
  importBindings: ParsedImportBinding[];
  exports: string[];
  calls: string[];
  extendsTypes: string[];
  implementsTypes: string[];
}

export interface FileProvider {
  listFiles(root: string, extensions?: string[], ignore?: string[]): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ mtimeMs: number } | null>;
}

export interface LanguageParser {
  readonly supportedExtensions: string[];
  readonly parserVersion: string;
  parseFile(filePath: string, content: string): ParsedSymbol[];
}

export interface Embedder {
  embedTexts(
    texts: string[],
    options?: {
      onProgress?: (progress: EmbeddingProgress) => void;
    }
  ): Promise<number[][]>;
  readonly modelId: string;
  readonly dimensions: number;
}

export interface EmbeddingProgress {
  stage: "embed";
  message?: string;
  batchIndex?: number;
  totalBatches?: number;
  completedTexts?: number;
  totalTexts?: number;
}

export interface EmbeddingMetadata {
  modelId: string;
  dimensions: number;
}

export type EmbedderKind =
  | "none"
  | "ollama"
  | "openai_compatible"
  | "nvidia_nemotron"
  | "step_3_5_flash"
  | "minimax_2_5";

export type SearchMode = "fulltext" | "semantic" | "hybrid";

export interface SymbolSearchQuery {
  repoId?: string;
  text?: string;
  exactSymbolName?: string;
  filePath?: string;
  pathPrefix?: string;
  symbolKind?: SymbolKind;
  embedding?: number[];
  mode?: SearchMode;
  limit?: number;
}

export interface PathSearchQuery {
  repoId?: string;
  query?: string;
  pathPrefix?: string;
  limit?: number;
}

export interface IndexStorage {
  upsertSymbols(symbols: CodeSymbolRow[]): Promise<void>;
  upsertEdges(edges: EdgeRow[]): Promise<void>;
  searchSymbols(query: SymbolSearchQuery): Promise<CodeSymbolRow[]>;
  searchPaths(query: PathSearchQuery): Promise<string[]>;
  listSymbols(repoId: string): Promise<CodeSymbolRow[]>;
  getSymbolById(id: string): Promise<CodeSymbolRow | null>;
  getSymbolsByFile(repoId: string, filePath: string): Promise<CodeSymbolRow[]>;
  getEdgesFrom(symbolId: string): Promise<EdgeRow[]>;
  getEdgesTo(symbolId: string): Promise<EdgeRow[]>;
  deleteSymbolsByFile(repoId: string, filePath: string): Promise<void>;
  deleteSymbolsByFiles(repoId: string, filePaths: string[]): Promise<void>;
  getEmbeddingMetadata(repoId: string): Promise<EmbeddingMetadata | null>;
  optimize?(): Promise<void>;
}

export interface ChangeTracker {
  getChangedFiles(since?: string): Promise<string[]>;
  getCurrentRevision(): Promise<string | null>;
}

export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  symbolsIndexed: number;
}

export interface CodebaseMap {
  repoId: string;
  files: number;
  symbols: number;
  edges: number;
  byKind: Partial<Record<SymbolKind, number>>;
}

export interface CodeIntelConfig {
  repoId: string;
  rootPath: string;
  extensions: string[];
  ignore: string[];
  storage: "memory" | "lancedb";
  storagePath?: string;
  embed: boolean;
  embedder: EmbedderKind;
  embeddingModelId?: string;
  embeddingBaseUrl?: string;
  embeddingDimensions?: number;
}

export const DEFAULT_CONFIG: Omit<CodeIntelConfig, "repoId" | "rootPath"> = {
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  ignore: ["node_modules", "dist", "dist-docs", "evals/workspaces", ".git", "build", "coverage", ".next"],
  storage: "memory",
  embed: false,
  embedder: "none",
};
