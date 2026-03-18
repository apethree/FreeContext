import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const DEFAULT_ENDPOINT =
  process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
  process.env.MCP_SERVER_URL ??
  "http://127.0.0.1:3214/mcp";
const GET_SYMBOL_SENTINEL = "__FREE_CONTEXT_GET_SYMBOL_DISPATCH_PLUGIN__";

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function resolveGetSymbolArgs(args) {
  if (args?.id !== GET_SYMBOL_SENTINEL) {
    return args;
  }

  const rootPath = resolve(process.env.FREE_CONTEXT_EVAL_ROOT ?? process.cwd());
  const repoId = `repo-${contentHash(rootPath)}`;
  const filePath = process.env.FREE_CONTEXT_GET_SYMBOL_FILE ?? "apps/gateway/src/channels/plugin-registry.ts";
  const symbolName = process.env.FREE_CONTEXT_GET_SYMBOL_NAME ?? "dispatchPlugin";
  const symbolKind = process.env.FREE_CONTEXT_GET_SYMBOL_KIND ?? "function";
  const occurrence = Number(process.env.FREE_CONTEXT_GET_SYMBOL_OCCURRENCE ?? "1");
  return {
    ...args,
    id: `sym_${contentHash(`${repoId}:${filePath}:${symbolKind}:${symbolName}:${occurrence}`)}`,
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
    const rawConfig = context.config ?? this.config ?? {};
    const providerConfig = rawConfig.config ?? rawConfig;
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
