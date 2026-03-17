export { CodeIntelEngine } from "./core/engine.js";
export { loadProjectConfig } from "./core/config-loader.js";
export { MemoryStorage } from "./storage/memory-storage.js";
export { LanceDbStorage } from "./storage/lancedb-storage.js";
export { TreeSitterParser } from "./parser/ts-parser.js";
export { contentHash } from "./parser/hash.js";
export { Indexer } from "./indexer/indexer.js";
export { buildSymbolId, buildEdgeId } from "./indexer/ids.js";
export { NodeFileProvider } from "./indexer/node-file-provider.js";
export { SearchService } from "./search/search-service.js";
export type { SearchOptions } from "./search/search-service.js";
export { EdgeExtractor, GraphService, RepoSymbolMap } from "./graph/index.js";
export { GitChangeTracker } from "./git/index.js";
export {
  FreeContextMcpServer,
  createEngineForMcp,
  registerFreeContextTools,
} from "./mcp/index.js";
export { NoopEmbedder } from "./embeddings/noop-embedder.js";
export { OllamaEmbedder, OLLAMA_EMBEDDING_DEFAULTS } from "./embeddings/ollama-embedder.js";
export { RemoteEmbedder } from "./embeddings/remote-embedder.js";
export {
  NvidiaNemotronEmbedder,
  StepFlashEmbedder,
  MinimaxEmbedder,
  DEFAULT_NVIDIA_EMBEDDING_MODEL,
  DEFAULT_STEP_EMBEDDING_MODEL,
  DEFAULT_MINIMAX_EMBEDDING_MODEL,
} from "./embeddings/provider-embedder.js";
export type {
  CodeSymbolRow,
  EdgeRow,
  ParsedImportBinding,
  ParsedSymbol,
  SymbolKind,
  EdgeKind,
  SearchMode,
  EmbedderKind,
  FileProvider,
  LanguageParser,
  Embedder,
  IndexStorage,
  ChangeTracker,
  IndexResult,
  CodebaseMap,
  SymbolSearchQuery,
  PathSearchQuery,
  CodeIntelConfig,
} from "./types/index.js";
export type {
  FreeContextMcpApi,
  FreeContextMcpStartedServer,
  FreeContextMcpServerOptions,
} from "./mcp/index.js";
