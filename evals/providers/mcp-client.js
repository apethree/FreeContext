import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const DEFAULT_ENDPOINT =
  process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
  process.env.MCP_SERVER_URL ??
  "http://127.0.0.1:3214/mcp";
const GET_SYMBOL_SENTINEL = "__FREE_CONTEXT_GET_SYMBOL_LANCEDB__";

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function resolveGetSymbolArgs(args) {
  if (args?.id !== GET_SYMBOL_SENTINEL) {
    return args;
  }

  const rootPath = resolve(process.cwd());
  const repoId = `repo-${contentHash(rootPath)}`;
  return {
    ...args,
    id: `sym_${contentHash(`${repoId}:src/storage/lancedb-storage.ts:class:LanceDbStorage:1`)}`,
  };
}

export default class McpClientProvider {
  constructor(config = {}) {
    this.config = config;
  }

  id() {
    return "mcp-client";
  }

  async callApi(_prompt, context) {
    const providerConfig = context.config ?? this.config ?? {};
    const endpointFromEnvVar =
      typeof providerConfig.endpointEnvVar === "string"
        ? process.env[providerConfig.endpointEnvVar]
        : undefined;
    const { tool, args, endpoint = endpointFromEnvVar ?? DEFAULT_ENDPOINT } = context.vars ?? {};
    if (!tool || typeof tool !== "string") {
      return {
        error: "Missing vars.tool for MCP provider.",
      };
    }

    const client = new Client({ name: "promptfoo-eval", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(String(endpoint))));

    try {
      const result = await client.callTool({
        name: tool,
        arguments:
          (args && typeof args === "object")
            ? resolveGetSymbolArgs(args)
            : {},
      });

      if (!result.structuredContent) {
        throw new Error(`Tool ${tool} returned no structuredContent`);
      }

      return {
        output: JSON.stringify(result.structuredContent),
      };
    } finally {
      await client.close();
    }
  }
}
