/**
 * Provider 4: Claude + Context7 MCP (native web search disabled).
 *
 * Spawns @upstash/context7-mcp via npx as a stdio subprocess.
 * Context7 searches package documentation — ideal for researching
 * SDK APIs, version changes, and protocol specs.
 * Native Anthropic web search is NOT included.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  loadEnv,
  requireEnv,
  buildResult,
  callAnthropicAgentic,
  mcpToolsToAnthropic,
} from "./shared.js";

loadEnv();

const MODEL = process.env.ANTHROPIC_WEB_EVAL_MODEL ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM =
  "You are a research assistant. " +
  "You have access to the Context7 documentation search tools (resolve-library-id and get-library-docs). " +
  "Use these tools to look up current API documentation, version information, and code examples. " +
  "You do NOT have native web search capability; only the provided Context7 tools may fetch data. " +
  "Resolve the relevant library first, then query its docs. Synthesize a clear answer from what you find.";

export default class ClaudeContext7Provider {
  id() {
    return "claude-context7";
  }

  async callApi(prompt) {
    const start = Date.now();

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    });

    const client = new Client({ name: "websearch-eval-context7", version: "1.0.0" });
    await client.connect(transport);

    try {
      const { tools: rawTools } = await client.listTools();
      const tools = mcpToolsToAnthropic(rawTools);

      const { output, promptTokens, completionTokens, toolCallCount, modelRounds, toolsUsed } =
        await callAnthropicAgentic({
          prompt,
          system: SYSTEM,
          tools,
          executeTool: async (name, input) => {
            const result = await client.callTool({ name, arguments: input });
            const content = result.content ?? result.structuredContent ?? {};
            if (Array.isArray(content)) {
              return content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
            }
            return typeof content === "string" ? content : JSON.stringify(content);
          },
          maxRounds: 10,
          model: MODEL,
        });

      return buildResult({
        output,
        model: MODEL,
        promptTokens,
        completionTokens,
        toolCallCount,
        modelRounds,
        totalMs: Date.now() - start,
        searchProvider: "context7-docs",
        toolsUsed,
        metadata: { mcpTools: rawTools.map((t) => t.name) },
      });
    } finally {
      await client.close();
    }
  }
}
