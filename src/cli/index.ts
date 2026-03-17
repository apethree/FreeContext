#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { CodeIntelEngine } from "../core/engine.js";
import { loadProjectConfig } from "../core/config-loader.js";
import { FreeContextMcpServer } from "../mcp/server.js";
import type { SymbolKind, SearchMode, CodeIntelConfig } from "../types/index.js";
import {
  createAgentSetupPlan,
  type AgentClient,
  type ScoutProvider,
} from "./agent-setup.js";

const SYMBOL_KINDS: SymbolKind[] = [
  "function",
  "method",
  "class",
  "interface",
  "type_alias",
  "variable",
  "import",
  "export",
  "file_summary",
];

const STORAGE_OPTIONS: CodeIntelConfig["storage"][] = ["memory", "lancedb"];
const EMBEDDER_OPTIONS: CodeIntelConfig["embedder"][] = [
  "none",
  "ollama",
  "openai_compatible",
  "nvidia_nemotron",
  "step_3_5_flash",
  "minimax_2_5",
];
const AGENT_CLIENTS: AgentClient[] = [
  "claude-code",
  "cursor",
  "codex",
  "gemini-cli",
  "opencode",
];
const SCOUT_PROVIDERS: ScoutProvider[] = ["anthropic", "openai", "openrouter"];

const program = new Command();

program
  .name("free-context")
  .description("TypeScript-native code intelligence engine")
  .version("0.1.0");

program
  .command("index")
  .description("Index a codebase")
  .argument("[path]", "Path to codebase root", ".")
  .option("--repo-id <id>", "Repository ID")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--embed", "Generate embeddings while indexing", false)
  .option("--embedder <name>", "Embedder backend", "none")
  .option("--embedding-model-id <id>", "Override the embedding model name")
  .option("--embedding-base-url <url>", "Base URL for ollama or OpenAI-compatible embedding servers")
  .option("--embedding-dimensions <n>", "Embedding dimensions override")
  .action(async (path: string, opts: CliOptions) => {
    validateCliOptions(opts);
    const rootPath = resolve(path);
    console.log(`Indexing ${rootPath}...`);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    const result = await engine.index();
    console.log(
      `Indexed ${result.filesIndexed} files, skipped ${result.filesSkipped}, wrote ${result.symbolsIndexed} symbols`
    );
  });

program
  .command("search")
  .description("Search indexed symbols")
  .argument("[query]", "Search query")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--file <file>", "Filter results to one relative file path")
  .option("--path-prefix <prefix>", "Restrict results to file paths under one prefix")
  .option("--kind <kind>", "Filter results by symbol kind")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--embed", "Enable query embeddings", false)
  .option("--embedder <name>", "Embedder backend", "none")
  .option("--embedding-model-id <id>", "Override the embedding model name")
  .option("--embedding-base-url <url>", "Base URL for ollama or OpenAI-compatible embedding servers")
  .option("--embedding-dimensions <n>", "Embedding dimensions override")
  .option("--semantic", "Use semantic vector search", false)
  .option("--hybrid", "Use hybrid full-text + semantic search", false)
  .option("--reindex", "Refresh the index before searching", false)
  .option("--limit <n>", "Max results", "20")
  .action(
    async (
      query: string | undefined,
      opts: SearchCliOptions
    ) => {
      validateCliOptions(opts);
      if (!query && !opts.file) {
        console.error("Provide a query or use --file to search within one file.");
        process.exitCode = 1;
        return;
      }
      if (opts.kind && !SYMBOL_KINDS.includes(opts.kind as SymbolKind)) {
        console.error(`Invalid symbol kind: ${opts.kind}`);
        console.error(`Expected one of: ${SYMBOL_KINDS.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      if (opts.semantic && opts.hybrid) {
        console.error("Choose either --semantic or --hybrid, not both.");
        process.exitCode = 1;
        return;
      }
      if ((opts.semantic || opts.hybrid) && !query) {
        console.error("Semantic and hybrid search require a text query.");
        process.exitCode = 1;
        return;
      }

      const rootPath = resolve(opts.path);
      const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
      if (opts.storage === "memory" || opts.reindex) {
        await engine.index();
      }
      const mode: SearchMode = opts.hybrid
        ? "hybrid"
        : opts.semantic
          ? "semantic"
          : "fulltext";
      const results = await engine.querySymbols({
        text: query,
        filePath: opts.file,
        pathPrefix: opts.pathPrefix,
        symbolKind: opts.kind as SymbolKind | undefined,
        mode,
        limit: parseInt(opts.limit, 10),
      });
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }
      for (const sym of results) {
        console.log(
          `${sym.symbolKind.padEnd(12)} ${sym.symbolName.padEnd(30)} ${sym.filePath}:${sym.startLine}`
        );
      }
    }
  );

program
  .command("search-paths")
  .description("Search indexed file paths")
  .argument("[query]", "Path query", "")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--path-prefix <prefix>", "Restrict results to one directory prefix")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--reindex", "Refresh the index before searching", false)
  .option("--limit <n>", "Max results", "20")
  .action(async (query: string, opts: PathSearchCliOptions) => {
    validateCliOptions(opts);
    if (!query && !opts.pathPrefix) {
      console.error("Provide a path query or use --path-prefix.");
      process.exitCode = 1;
      return;
    }

    const rootPath = resolve(opts.path);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    if (opts.storage === "memory" || opts.reindex) {
      await engine.index();
    }

    const results = await engine.searchPaths(
      query,
      parseInt(opts.limit, 10),
      opts.pathPrefix
    );
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const filePath of results) {
      console.log(filePath);
    }
  });

program
  .command("who-calls")
  .description("List callers for a symbol")
  .argument("<symbolName>", "Symbol name to resolve")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--reindex", "Refresh the index before querying", false)
  .action(async (symbolName: string, opts: QueryCliOptions) => {
    validateCliOptions(opts);
    const rootPath = resolve(opts.path);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    if (opts.storage === "memory" || opts.reindex) {
      await engine.index();
    }
    const results = await engine.whoCalls(symbolName);
    printSymbolResults(results);
  });

program
  .command("what-does-this-call")
  .description("List callees for a symbol")
  .argument("<symbolName>", "Symbol name to resolve")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--reindex", "Refresh the index before querying", false)
  .action(async (symbolName: string, opts: QueryCliOptions) => {
    validateCliOptions(opts);
    const rootPath = resolve(opts.path);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    if (opts.storage === "memory" || opts.reindex) {
      await engine.index();
    }
    const results = await engine.whatDoesThisCall(symbolName);
    printSymbolResults(results);
  });

program
  .command("recently-changed")
  .description("List indexed symbols from git-changed files")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--since <rev>", "Git revision or range start")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--reindex", "Refresh the index before querying", false)
  .action(async (opts: RecentlyChangedCliOptions) => {
    validateCliOptions(opts);
    const rootPath = resolve(opts.path);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    if (opts.storage === "memory" || opts.reindex) {
      await engine.index();
    }
    const results = await engine.recentlyChangedSymbols(opts.since);
    printSymbolResults(results);
  });

program
  .command("codebase-map")
  .description("Print a high-level symbol and edge summary")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--storage <type>", "Storage backend", "memory")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--reindex", "Refresh the index before querying", false)
  .action(async (opts: QueryCliOptions) => {
    validateCliOptions(opts);
    const rootPath = resolve(opts.path);
    const engine = new CodeIntelEngine(engineConfigFromCli(rootPath, opts));
    if (opts.storage === "memory" || opts.reindex) {
      await engine.index();
    }
    const summary = await engine.codebaseMap();
    console.log(`repoId: ${summary.repoId}`);
    console.log(`files: ${summary.files}`);
    console.log(`symbols: ${summary.symbols}`);
    console.log(`edges: ${summary.edges}`);
    for (const [kind, count] of Object.entries(summary.byKind).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`${kind}: ${count}`);
    }
  });

program
  .command("serve")
  .description("Start the MCP server")
  .argument("[path]", "Path to codebase root", ".")
  .option("--port <n>", "Port to listen on", "3100")
  .option("--host <host>", "Host interface to bind", "127.0.0.1")
  .option("--repo-id <id>", "Repository ID")
  .option("--storage <type>", "Storage backend")
  .option("--storage-path <path>", "Path to LanceDB storage")
  .option("--embed", "Generate embeddings while indexing", false)
  .option("--embedder <name>", "Embedder backend")
  .option("--embedding-model-id <id>", "Override the embedding model name")
  .option("--embedding-base-url <url>", "Base URL for ollama or OpenAI-compatible embedding servers")
  .option("--embedding-dimensions <n>", "Embedding dimensions override")
  .option("--no-reindex", "Skip the initial incremental index pass")
  .action(async (path: string, opts: ServeCliOptions) => {
    validateCliOptions({
      storage: opts.storage ?? "memory",
      embedder: opts.embedder ?? "none",
      storagePath: opts.storagePath,
      repoId: opts.repoId,
      embed: Boolean(opts.embed),
    });

    const rootPath = resolve(path);
    const projectConfig = await loadProjectConfig(rootPath);
    const engine = new CodeIntelEngine({
      ...projectConfig,
      rootPath,
      repoId: opts.repoId ?? projectConfig.repoId,
      storage: opts.storage ?? projectConfig.storage,
      storagePath: opts.storagePath ? resolve(opts.storagePath) : projectConfig.storagePath,
      embed: opts.embed || projectConfig.embed,
      embedder: opts.embedder ?? projectConfig.embedder,
      embeddingModelId: opts.embeddingModelId ?? projectConfig.embeddingModelId,
      embeddingBaseUrl: opts.embeddingBaseUrl ?? projectConfig.embeddingBaseUrl,
      embeddingDimensions: opts.embeddingDimensions
        ? parseInt(opts.embeddingDimensions, 10)
        : projectConfig.embeddingDimensions,
    });

    const mcpServer = new FreeContextMcpServer({
      engine,
      port: parseInt(opts.port, 10),
      host: opts.host,
      reindexOnStart: opts.reindex,
    });
    const started = await mcpServer.start();

    console.log(`MCP server listening at ${started.endpoint}`);
    console.log(`Health check: http://${started.host}:${started.port}/health`);

    const shutdown = async () => {
      await mcpServer.close();
      process.exit(0);
    };

    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
  });

program
  .command("setup-agent")
  .description("Print recommended MCP stack and client config for a coding agent")
  .argument("<client>", "Agent client: claude-code, cursor, codex, gemini-cli, opencode")
  .option("--path <path>", "Path to project root", ".")
  .option("--host <host>", "Host interface for the MCP server", "127.0.0.1")
  .option("--port <n>", "Port for the MCP server", "3100")
  .option("--scout-provider <name>", "Optional scout API provider")
  .option("--scout-model <id>", "Optional scout model id override")
  .action((client: string, opts: SetupAgentCliOptions) => {
    if (!AGENT_CLIENTS.includes(client as AgentClient)) {
      console.error(`Invalid agent client: ${client}`);
      console.error(`Expected one of: ${AGENT_CLIENTS.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    if (opts.scoutProvider && !SCOUT_PROVIDERS.includes(opts.scoutProvider as ScoutProvider)) {
      console.error(`Invalid scout provider: ${opts.scoutProvider}`);
      console.error(`Expected one of: ${SCOUT_PROVIDERS.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const rootPath = resolve(opts.path);
    const plan = createAgentSetupPlan(client as AgentClient, {
      host: opts.host,
      port: parseInt(opts.port, 10),
      projectPath: rootPath,
      scoutProvider: opts.scoutProvider as ScoutProvider | undefined,
      scoutModel: opts.scoutModel,
    });

    console.log(`Recommended MCP stack for ${plan.client}:`);
    for (const mcp of plan.recommendedMcps) {
      console.log(`- [${mcp.category}] ${mcp.name}: ${mcp.purpose}`);
      console.log(`  ${mcp.note}`);
    }
    console.log("");
    console.log("Start FreeContext:");
    console.log(plan.startCommand);
    console.log("");
    console.log("Client setup:");
    console.log(plan.setupText);
    console.log("");
    console.log("Verify:");
    console.log(plan.verifyHint);
    if (plan.scoutText) {
      console.log("");
      console.log(plan.scoutText);
    }
  });

program.parse();

interface CliOptions {
  repoId?: string;
  storage: CodeIntelConfig["storage"];
  storagePath?: string;
  embed: boolean;
  embedder: CodeIntelConfig["embedder"];
  embeddingModelId?: string;
  embeddingBaseUrl?: string;
  embeddingDimensions?: string;
}

interface SearchCliOptions extends CliOptions {
  path: string;
  file?: string;
  pathPrefix?: string;
  kind?: string;
  limit: string;
  semantic: boolean;
  hybrid: boolean;
  reindex: boolean;
}

interface PathSearchCliOptions extends QueryCliOptions {
  pathPrefix?: string;
  limit: string;
}

interface QueryCliOptions extends CliOptions {
  path: string;
  reindex: boolean;
}

interface RecentlyChangedCliOptions extends QueryCliOptions {
  since?: string;
}

interface ServeCliOptions extends Partial<CliOptions> {
  port: string;
  host: string;
  reindex: boolean;
}

interface SetupAgentCliOptions {
  path: string;
  host: string;
  port: string;
  scoutProvider?: string;
  scoutModel?: string;
}

function validateCliOptions(opts: CliOptions): void {
  const storage = opts.storage ?? "memory";
  const embedder = opts.embedder ?? "none";

  if (!STORAGE_OPTIONS.includes(storage)) {
    throw new Error(`Invalid storage backend: ${storage}`);
  }

  if (!EMBEDDER_OPTIONS.includes(embedder)) {
    throw new Error(`Invalid embedder: ${embedder}`);
  }
}

function engineConfigFromCli(
  rootPath: string,
  opts: CliOptions | SearchCliOptions
): Partial<CodeIntelConfig> & { rootPath: string } {
  const searchOpts = opts as Partial<SearchCliOptions>;
  const requestedEmbedder = opts.embedder ?? "none";
  const wantsEmbeddings =
    opts.embed ||
    Boolean(searchOpts.semantic || searchOpts.hybrid);
  const embedder =
    requestedEmbedder === "none"
      ? wantsEmbeddings
        ? "ollama"
        : "none"
      : requestedEmbedder;

  return {
    rootPath,
    repoId: opts.repoId,
    storage: opts.storage ?? "memory",
    storagePath: opts.storagePath ? resolve(opts.storagePath) : undefined,
    embed: wantsEmbeddings || embedder !== "none",
    embedder,
    embeddingModelId: opts.embeddingModelId,
    embeddingBaseUrl: opts.embeddingBaseUrl,
    embeddingDimensions: opts.embeddingDimensions
      ? parseInt(opts.embeddingDimensions, 10)
      : undefined,
  };
}

function printSymbolResults(results: Array<{ symbolKind: string; symbolName: string; filePath: string; startLine: number }>): void {
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  for (const sym of results) {
    console.log(
      `${sym.symbolKind.padEnd(12)} ${sym.symbolName.padEnd(30)} ${sym.filePath}:${sym.startLine}`
    );
  }
}
