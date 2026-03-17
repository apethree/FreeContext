/**
 * Provider 2: Claude + Gemini search MCP (native web search disabled).
 *
 * Spawns ~/.claude/run-gemini-mcp.sh as a stdio MCP subprocess using
 * StdioClientTransport. Lists the server's tools, exposes them all to Claude.
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
  "You have access to web search tools — use them to find current, accurate information. " +
  "You do NOT have native web search capability; only the provided tools may fetch web data. " +
  "Synthesize the tool results into a clear, comprehensive answer. Cite sources.";

const GEMINI_MCP_SCRIPT = process.env.GEMINI_MCP_SCRIPT ?? "/Users/narya/.claude/run-gemini-mcp.sh";

export default class ClaudeGeminiMcpProvider {
  id() {
    return "claude-gemini-mcp";
  }

  async callApi(prompt) {
    const start = Date.now();

    const transport = new StdioClientTransport({
      command: "bash",
      args: [GEMINI_MCP_SCRIPT],
    });

    const client = new Client({ name: "websearch-eval-gemini", version: "1.0.0" });
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
            return JSON.stringify(content);
          },
          maxRounds: 8,
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
        searchProvider: "gemini-mcp",
        toolsUsed,
        metadata: { mcpTools: rawTools.map((t) => t.name) },
      });
    } finally {
      await client.close();
    }
  }
}
