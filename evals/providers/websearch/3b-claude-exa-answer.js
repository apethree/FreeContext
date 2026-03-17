/**
 * Provider 3b: Claude + Exa /answer via opencode-mcp (native web disabled).
 *
 * Uses the exa_answer tool which calls api.exa.ai/answer directly — returns
 * a synthesized answer + citations instead of raw page dumps.
 * Requires EXA_API_KEY in env.
 *
 * Compare against provider 3 (raw Exa) to see the token difference.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  loadEnv,
  buildResult,
  callAnthropicAgentic,
  mcpToolsToAnthropic,
} from "./shared.js";

loadEnv();

const MODEL = process.env.ANTHROPIC_WEB_EVAL_MODEL ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM =
  "You are a research assistant. " +
  "You have access to the exa_answer tool which returns a synthesized answer with citations — " +
  "use it to look up current information. " +
  "You do NOT have native web search capability; only the provided tools may fetch web data. " +
  "Use the tool result to compose your final answer, citing the sources provided.";

const OPENCODE_MCP_SCRIPT =
  process.env.OPENCODE_MCP_SCRIPT ?? "/Users/narya/.claude/opencode-mcp/index.js";

const ALLOWED_TOOLS = new Set(["exa_answer"]);

export default class ClaudeExaAnswerProvider {
  id() {
    return "claude-exa-answer";
  }

  async callApi(prompt) {
    const start = Date.now();

    const transport = new StdioClientTransport({
      command: "node",
      args: [OPENCODE_MCP_SCRIPT],
      env: {
        ...process.env,
        EXA_API_KEY: process.env.EXA_API_KEY ?? "",
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
      },
    });

    const client = new Client({ name: "websearch-eval-exa-answer", version: "1.0.0" });
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
              return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
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
        searchProvider: "exa-answer-api",
        toolsUsed,
      });
    } finally {
      await client.close();
    }
  }
}
