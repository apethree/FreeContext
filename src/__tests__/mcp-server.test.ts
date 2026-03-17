import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CodeSymbolRow, CodebaseMap, IndexResult } from "../types/index.js";
import {
  FreeContextMcpServer,
  registerFreeContextTools,
  type FreeContextMcpApi,
} from "../mcp/server.js";

describe("registerFreeContextTools", () => {
  it("registers the expected Phase 4 tool set", () => {
    const registrar = new FakeRegistrar();
    registerFreeContextTools(registrar, makeEngineApi(), async () => ({
      filesIndexed: 1,
      filesSkipped: 0,
      symbolsIndexed: 2,
    }));

    expect(registrar.names()).toEqual([
      "search_code",
      "search_paths",
      "find_symbol",
      "get_symbol",
      "list_file_symbols",
      "who_calls",
      "what_does_this_call",
      "recently_changed_symbols",
      "reindex",
      "codebase_map",
    ]);
  });

  it("returns exact symbol matches for find_symbol", async () => {
    const registrar = new FakeRegistrar();
    registerFreeContextTools(registrar, makeEngineApi(), async () => ({
      filesIndexed: 1,
      filesSkipped: 0,
      symbolsIndexed: 2,
    }));

    const result = await registrar.call("find_symbol", { name: "SearchService" });

    expect(result.structuredContent?.count).toBe(1);
    expect(result.structuredContent?.results).toEqual([
      {
        id: "sym-1",
        symbolName: "SearchService",
        symbolKind: "class",
        filePath: "src/search.ts",
        startLine: 1,
        endLine: 12,
      },
    ]);
  });

  it("uses exact symbol lookup instead of capped text prefiltering", async () => {
    const registrar = new FakeRegistrar();
    registerFreeContextTools(registrar, makeEngineApi(), async () => ({
      filesIndexed: 1,
      filesSkipped: 0,
      symbolsIndexed: 2,
    }));

    const result = await registrar.call("find_symbol", { name: "SearchService" });

    expect(result.structuredContent?.count).toBe(1);
    expect(result.structuredContent?.results).toEqual([
      {
        id: "sym-1",
        symbolName: "SearchService",
        symbolKind: "class",
        filePath: "src/search.ts",
        startLine: 1,
        endLine: 12,
      },
    ]);
  });

  it("returns matching file paths for search_paths", async () => {
    const registrar = new FakeRegistrar();
    registerFreeContextTools(registrar, makeEngineApi(), async () => ({
      filesIndexed: 1,
      filesSkipped: 0,
      symbolsIndexed: 2,
    }));

    const result = await registrar.call("search_paths", {
      query: "search",
      pathPrefix: "src/",
    });

    expect(result.structuredContent).toEqual({
      count: 2,
      results: ["src/search.ts", "src/search/index.ts"],
    });
  });

  it("returns index results from the reindex tool", async () => {
    const registrar = new FakeRegistrar();
    registerFreeContextTools(registrar, makeEngineApi(), async () => ({
      filesIndexed: 3,
      filesSkipped: 4,
      symbolsIndexed: 12,
    }));

    const result = await registrar.call("reindex", {});

    expect(result.structuredContent).toEqual({
      filesIndexed: 3,
      filesSkipped: 4,
      symbolsIndexed: 12,
    });
  });
});

describe("FreeContextMcpServer", () => {
  let server: FreeContextMcpServer | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("serves health and exposes MCP tools over streamable HTTP", async () => {
    server = new FreeContextMcpServer({
      engine: makeEngineApi(),
      host: "127.0.0.1",
      port: 0,
      reindexOnStart: false,
    });

    const started = await server.start();
    const health = await fetch(`http://${started.host}:${started.port}/health`).then((response) =>
      response.json() as Promise<{ status: string; repoId: string }>
    );

    expect(health.status).toBe("ok");
    expect(health.repoId).toBe("repo-1");

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(started.endpoint)));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("search_paths");

    const result = await client.callTool({
      name: "codebase_map",
      arguments: {},
    });

    expect(result.structuredContent).toEqual({
      repoId: "repo-1",
      files: 2,
      symbols: 3,
      edges: 1,
      byKind: {
        class: 1,
        function: 2,
      },
    });
  });

  it("allows GET /mcp so the transport can negotiate streaming", async () => {
    server = new FreeContextMcpServer({
      engine: makeEngineApi(),
      host: "127.0.0.1",
      port: 0,
      reindexOnStart: false,
    });

    const started = await server.start();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(started.endpoint, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    expect(response.status).not.toBe(405);
    response.body?.cancel();
  });
});

class FakeRegistrar {
  private handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      structuredContent?: Record<string, unknown>;
    }>
  >();

  registerTool(
    name: string,
    _config: object,
    handler: (args: Record<string, unknown>) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      structuredContent?: Record<string, unknown>;
    }>
  ): void {
    this.handlers.set(name, handler);
  }

  names(): string[] {
    return Array.from(this.handlers.keys());
  }

  async call(name: string, args: Record<string, unknown>) {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`Missing handler for ${name}`);
    }
    return handler(args);
  }
}

function makeEngineApi(): FreeContextMcpApi {
  const searchServiceSymbol = makeSymbol({
    id: "sym-1",
    symbolName: "SearchService",
    symbolKind: "class",
    filePath: "src/search.ts",
    startLine: 1,
    endLine: 12,
  });
  const searchHelper = makeSymbol({
    id: "sym-2",
    symbolName: "searchHelper",
    symbolKind: "function",
    filePath: "src/search.ts",
    startLine: 14,
    endLine: 20,
  });
  const searchAll = makeSymbol({
    id: "sym-3",
    symbolName: "searchAll",
    symbolKind: "function",
    filePath: "src/search.ts",
    startLine: 22,
    endLine: 30,
  });

  return {
    config: {
      repoId: "repo-1",
      rootPath: "/tmp/project",
      extensions: [".ts"],
      ignore: [],
      storage: "memory",
      embed: false,
      embedder: "none",
    },
    async querySymbols(args) {
      if (args.text === "SearchService") {
        return [searchHelper, searchAll];
      }
      return [searchServiceSymbol, searchHelper, searchAll];
    },
    async findSymbol(name, kind) {
      return [searchServiceSymbol, searchHelper, searchAll].filter((symbol) => {
        if (symbol.symbolName !== name) {
          return false;
        }
        if (kind && symbol.symbolKind !== kind) {
          return false;
        }
        return true;
      });
    },
    async searchPaths(query, _limit, pathPrefix) {
      const paths = ["src/search.ts", "src/search/index.ts", "docs/search.md"];
      return paths.filter((filePath) => {
        if (query && !filePath.includes(query)) {
          return false;
        }
        if (pathPrefix && !filePath.startsWith(pathPrefix)) {
          return false;
        }
        return true;
      });
    },
    async getSymbol(id) {
      return [searchServiceSymbol, searchHelper, searchAll].find((symbol) => symbol.id === id) ?? null;
    },
    async listFileSymbols(filePath) {
      return filePath === "src/search.ts" ? [searchServiceSymbol, searchHelper, searchAll] : [];
    },
    async whoCalls() {
      return [searchAll];
    },
    async whatDoesThisCall() {
      return [searchHelper];
    },
    async recentlyChangedSymbols() {
      return [searchHelper];
    },
    async codebaseMap(): Promise<CodebaseMap> {
      return {
        repoId: "repo-1",
        files: 2,
        symbols: 3,
        edges: 1,
        byKind: {
          class: 1,
          function: 2,
        },
      };
    },
    async index(): Promise<IndexResult> {
      return {
        filesIndexed: 2,
        filesSkipped: 0,
        symbolsIndexed: 3,
      };
    },
  };
}

function makeSymbol(overrides: Partial<CodeSymbolRow>): CodeSymbolRow {
  return {
    id: "sym-default",
    repoId: "repo-1",
    filePath: "src/default.ts",
    language: "typescript",
    symbolName: "defaultSymbol",
    symbolKind: "function",
    startLine: 1,
    endLine: 2,
    hash: "hash",
    parserVersion: "1.0.0",
    embeddingModelId: null,
    rawText: "function defaultSymbol() {}",
    imports: [],
    exports: [],
    calls: [],
    isTest: false,
    tags: [],
    modifiedAt: 1,
    gitCommit: null,
    embedding: null,
    ...overrides,
  };
}
