/**
 * Provider 5: Claude + Scout agent via opencode-mcp (native web disabled).
 *
 * Uses openrouter_scout from the opencode-mcp server. The scout calls
 * OpenRouter free models (MiniMax M2.5 → StepFun 3.5 → Nemotron 120B)
 * with Exa web plugin — returning a summarised answer to Claude.
 * Claude uses the scout result to compose a final answer.
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
  "You have access to the openrouter_scout tool which sends your query to a free web-search-enabled model " +
  "(MiniMax, StepFun, or Nemotron via OpenRouter) that searches Exa and returns a summarised answer. " +
  "You do NOT have native web search capability; only the provided scout tool may fetch web data. " +
  "Call the scout with a precise search query, then use its answer to compose your final response.";

const OPENCODE_MCP_SCRIPT =
  process.env.OPENCODE_MCP_SCRIPT ?? "/Users/narya/.claude/opencode-mcp/index.js";

// Only expose the scout tool that uses OpenRouter + Exa web plugin
const ALLOWED_TOOLS = new Set(["openrouter_scout"]);

export default class ClaudeScoutAgentProvider {
  id() {
    return "claude-scout-agent";
  }

  async callApi(prompt) {
    const start = Date.now();

    const transport = new StdioClientTransport({
      command: "node",
      args: [OPENCODE_MCP_SCRIPT],
      env: {
        ...process.env,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
      },
    });

    const client = new Client({ name: "websearch-eval-scout", version: "1.0.0" });
    await client.connect(transport);

    try {
      const { tools: rawTools } = await client.listTools();
      const filteredRaw = rawTools.filter((t) => ALLOWED_TOOLS.has(t.name));
      const tools = mcpToolsToAnthropic(filteredRaw);

      const { output, promptTokens, completionTokens, toolCallCount, modelRounds, toolsUsed } =
        await callAnthropicAgentic({
          prompt,
          system: SYSTEM,
          tools,
          executeTool: async (name, input) => {
            const result = await client.callTool({ name, arguments: input });
            const content = result.content ?? [];
            if (Array.isArray(content)) {
              const text = content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
              // Surface tool errors clearly so Claude stops retrying
              if (text.toLowerCase().includes("unavailable") || text.toLowerCase().includes("error")) {
                return `Tool returned: ${text}\n\nNote: If the search tool is unavailable, answer based on your training knowledge and state that search was unavailable.`;
              }
              return text;
            }
            return JSON.stringify(content);
          },
          maxRounds: 4,
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
        searchProvider: "openrouter-scout-exa",
        toolsUsed,
      });
    } finally {
      await client.close();
    }
  }
}
