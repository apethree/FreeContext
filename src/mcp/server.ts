import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AddressInfo } from "node:net";
import type {
  CodeIntelConfig,
  CodeSymbolRow,
  CodebaseMap,
  IndexResult,
  SearchMode,
  SymbolKind,
} from "../types/index.js";
import { CodeIntelEngine } from "../core/engine.js";

const SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type_alias",
  "variable",
  "import",
  "export",
  "file_summary",
] as const satisfies readonly SymbolKind[];

const SEARCH_MODES = ["fulltext", "semantic", "hybrid"] as const satisfies readonly SearchMode[];

const searchCodeSchema = {
  query: z.string().min(1).describe("Text query to run against the indexed codebase."),
  limit: z.number().int().positive().max(200).optional(),
  filePath: z.string().min(1).optional(),
  pathPrefix: z.string().min(1).optional(),
  kind: z.enum(SYMBOL_KINDS).optional(),
  mode: z.enum(SEARCH_MODES).optional(),
};

const searchPathsSchema = {
  query: z.string().optional().default("").describe("Substring to match within indexed file paths."),
  pathPrefix: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
};

const findSymbolSchema = {
  name: z.string().min(1).describe("Exact symbol name to look up."),
  kind: z.enum(SYMBOL_KINDS).optional(),
};

const getSymbolSchema = {
  id: z.string().min(1).describe("Stable symbol ID."),
};

const listFileSymbolsSchema = {
  filePath: z.string().min(1).describe("Relative file path within the indexed repo."),
};

const symbolNameSchema = {
  symbolName: z.string().min(1).describe("Exact symbol name."),
};

const recentlyChangedSchema = {
  since: z.string().min(1).optional(),
};

export interface FreeContextMcpApi {
  config: CodeIntelConfig;
  querySymbols(args: {
    text?: string;
    filePath?: string;
    pathPrefix?: string;
    symbolKind?: SymbolKind;
    mode?: SearchMode;
    limit?: number;
  }): Promise<CodeSymbolRow[]>;
  findSymbol(name: string, kind?: SymbolKind): Promise<CodeSymbolRow[]>;
  searchPaths(query: string, limit?: number, pathPrefix?: string): Promise<string[]>;
  getSymbol(id: string): Promise<CodeSymbolRow | null>;
  listFileSymbols(filePath: string): Promise<CodeSymbolRow[]>;
  whoCalls(symbolName: string): Promise<CodeSymbolRow[]>;
  whatDoesThisCall(symbolName: string): Promise<CodeSymbolRow[]>;
  recentlyChangedSymbols(since?: string): Promise<CodeSymbolRow[]>;
  codebaseMap(): Promise<CodebaseMap>;
  index(): Promise<IndexResult>;
}

interface ToolRegistrar {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
      annotations?: unknown;
      _meta?: Record<string, unknown>;
    },
    cb: (...args: any[]) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      structuredContent?: Record<string, unknown>;
    }>
  ): unknown;
}

export interface FreeContextMcpServerOptions {
  engine: FreeContextMcpApi;
  port: number;
  host?: string;
  reindexOnStart?: boolean;
}

export interface FreeContextMcpStartedServer {
  port: number;
  host: string;
  endpoint: string;
}

export class FreeContextMcpServer {
  private httpServer = createServer();
  private reindexPromise: Promise<IndexResult> | null = null;

  constructor(private options: FreeContextMcpServerOptions) {
    this.httpServer.on("request", (req, res) => {
      void this.handleRequest(req, res);
    });
  }

  async start(): Promise<FreeContextMcpStartedServer> {
    if (this.options.reindexOnStart ?? true) {
      await this.runReindex();
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.httpServer.once("error", rejectPromise);
      this.httpServer.listen(this.options.port, this.options.host ?? "127.0.0.1", () => {
        this.httpServer.off("error", rejectPromise);
        resolvePromise();
      });
    });

    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve MCP server address.");
    }

    return {
      host: address.address,
      port: address.port,
      endpoint: `http://${formatHost(address)}:${address.port}/mcp`,
    };
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.httpServer.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }

  private handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", repoId: this.options.engine.config.repoId }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed.",
          },
          id: null,
        })
      );
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer(this.options.engine, () => this.runReindex());

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : "Internal server error",
            },
            id: null,
          })
        );
      }
    } finally {
      await transport.close();
      await server.close();
    }
  };

  private async runReindex(): Promise<IndexResult> {
    if (!this.reindexPromise) {
      this.reindexPromise = this.options.engine
        .index()
        .finally(() => {
          this.reindexPromise = null;
        });
    }

    return this.reindexPromise;
  }
}

function createMcpServer(
  engine: FreeContextMcpApi,
  reindex: () => Promise<IndexResult>
): McpServer {
  const server = new McpServer(
    {
      name: "free-context",
      version: "0.1.0",
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
        instructions:
          "Use FreeContext tools to inspect indexed code symbols, graph edges, and git-aware changes without dumping entire files.",
      }
    );
  registerFreeContextTools(server as unknown as ToolRegistrar, engine, reindex);
  return server;
}

export function registerFreeContextTools(
  server: ToolRegistrar,
  engine: FreeContextMcpApi,
  reindex: () => Promise<IndexResult>
): void {
  server.registerTool(
    "search_code",
    {
      title: "Search Code",
      description: "Search indexed code symbols by query, file path, symbol kind, and retrieval mode.",
      inputSchema: searchCodeSchema,
    },
    async ({ query, limit, filePath, pathPrefix, kind, mode }) => {
      const results = await engine.querySymbols({
        text: query as string,
        filePath: filePath as string | undefined,
        pathPrefix: pathPrefix as string | undefined,
        symbolKind: kind as SymbolKind | undefined,
        mode: mode as SearchMode | undefined,
        limit: (limit as number | undefined) ?? 20,
      });
      return toolResult("search_code", summarizeSymbols(results));
    }
  );

  server.registerTool(
    "search_paths",
    {
      title: "Search Paths",
      description: "Search indexed file paths by substring and optional directory prefix.",
      inputSchema: searchPathsSchema,
    },
    async ({ query, pathPrefix, limit }) => {
      const paths = await engine.searchPaths(
        (query as string | undefined) ?? "",
        (limit as number | undefined) ?? 20,
        pathPrefix as string | undefined
      );
      return toolResult("search_paths", {
        count: paths.length,
        results: paths,
      });
    }
  );

  server.registerTool(
    "find_symbol",
    {
      title: "Find Symbol",
      description: "Find exact symbol matches by name, optionally restricted to one symbol kind.",
      inputSchema: findSymbolSchema,
    },
    async ({ name, kind }) => {
      const exact = await engine.findSymbol(
        name as string,
        kind as SymbolKind | undefined
      );
      return toolResult("find_symbol", summarizeSymbols(exact));
    }
  );

  server.registerTool(
    "get_symbol",
    {
      title: "Get Symbol",
      description: "Fetch a single symbol by stable ID.",
      inputSchema: getSymbolSchema,
    },
    async ({ id }) => {
      const symbol = await engine.getSymbol(id as string);
      return toolResult("get_symbol", {
        symbol: symbol ? describeSymbol(symbol) : null,
      });
    }
  );

  server.registerTool(
    "list_file_symbols",
    {
      title: "List File Symbols",
      description: "List indexed symbols that belong to one file.",
      inputSchema: listFileSymbolsSchema,
    },
    async ({ filePath }) => {
      const symbols = await engine.listFileSymbols(filePath as string);
      return toolResult("list_file_symbols", summarizeSymbols(symbols));
    }
  );

  server.registerTool(
    "who_calls",
    {
      title: "Who Calls",
      description: "List symbols that call the named symbol.",
      inputSchema: symbolNameSchema,
    },
    async ({ symbolName }) => {
      const symbols = await engine.whoCalls(symbolName as string);
      return toolResult("who_calls", summarizeSymbols(symbols));
    }
  );

  server.registerTool(
    "what_does_this_call",
    {
      title: "What Does This Call",
      description: "List symbols called by the named symbol.",
      inputSchema: symbolNameSchema,
    },
    async ({ symbolName }) => {
      const symbols = await engine.whatDoesThisCall(symbolName as string);
      return toolResult("what_does_this_call", summarizeSymbols(symbols));
    }
  );

  server.registerTool(
    "recently_changed_symbols",
    {
      title: "Recently Changed Symbols",
      description: "List symbols from files changed relative to HEAD or a provided git revision.",
      inputSchema: recentlyChangedSchema,
    },
    async ({ since }) => {
      const symbols = await engine.recentlyChangedSymbols(since as string | undefined);
      return toolResult("recently_changed_symbols", summarizeSymbols(symbols));
    }
  );

  server.registerTool(
    "reindex",
    {
      title: "Reindex",
      description: "Run an incremental index pass for the configured repo.",
    },
    async () => {
      const result = await reindex();
      return toolResult("reindex", { ...result });
    }
  );

  server.registerTool(
    "codebase_map",
    {
      title: "Codebase Map",
      description: "Return a high-level summary of indexed files, symbols, and edges.",
    },
    async () => {
      const summary = await engine.codebaseMap();
      return toolResult("codebase_map", { ...summary });
    }
  );
}

export function createEngineForMcp(config: Partial<CodeIntelConfig> & { rootPath: string }): CodeIntelEngine {
  return new CodeIntelEngine(config);
}

function summarizeSymbols(symbols: CodeSymbolRow[]): {
  count: number;
  results: Array<ReturnType<typeof summarizeSymbol>>;
} {
  return {
    count: symbols.length,
    results: symbols.map((symbol) => summarizeSymbol(symbol)),
  };
}

function summarizeSymbol(symbol: CodeSymbolRow) {
  return {
    id: symbol.id,
    symbolName: symbol.symbolName,
    symbolKind: symbol.symbolKind,
    filePath: symbol.filePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };
}

function describeSymbol(symbol: CodeSymbolRow) {
  return {
    ...summarizeSymbol(symbol),
    imports: symbol.imports,
    exports: symbol.exports,
    calls: symbol.calls,
    rawText: symbol.rawText,
    parserVersion: symbol.parserVersion,
    embeddingModelId: symbol.embeddingModelId,
    gitCommit: symbol.gitCommit,
    modifiedAt: symbol.modifiedAt,
    isTest: symbol.isTest,
    tags: symbol.tags,
  };
}

function toolResult<T extends Record<string, unknown>>(name: string, value: T): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
} {
  return {
    content: [
      {
        type: "text",
        text: `${name}\n${JSON.stringify(value, null, 2)}`,
      },
    ],
    structuredContent: value,
  };
}

function formatHost(address: AddressInfo): string {
  return address.family === "IPv6" ? `[${address.address}]` : address.address;
}
