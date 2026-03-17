/**
 * Provider 1: Claude with Anthropic's native web_search tool.
 *
 * Uses the "web-search-2025-03-05" beta which lets Claude call
 * Anthropic's own search backend server-side. The client-side
 * agentic loop still handles multi-turn, but tool execution is
 * a no-op — Anthropic injects results automatically.
 */

import { loadEnv, requireEnv, buildResult, callAnthropicAgentic } from "./shared.js";

loadEnv();

const MODEL = process.env.ANTHROPIC_WEB_EVAL_MODEL ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM =
  "You are a research assistant with web search access. " +
  "Use the web_search tool to look up current, accurate information before answering. " +
  "After searching, synthesize what you found into a clear, comprehensive answer. " +
  "Cite sources where possible.";

// Native web_search tool definition (Anthropic beta)
const NATIVE_WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

export default class ClaudeNativeWebProvider {
  id() {
    return "claude-native-web";
  }

  async callApi(prompt) {
    const start = Date.now();

    const { output, promptTokens, completionTokens, toolCallCount, modelRounds, toolsUsed } =
      await callAnthropicAgentic({
        prompt,
        system: SYSTEM,
        tools: [NATIVE_WEB_SEARCH_TOOL],
        // Anthropic handles the actual search server-side; we return empty string
        // so the conversation loop continues after each tool_use block.
        executeTool: async () => "",
        extraHeaders: {
          "anthropic-beta": "web-search-2025-03-05",
        },
        maxRounds: 12,
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
      searchProvider: "anthropic-native",
      toolsUsed,
    });
  }
}
