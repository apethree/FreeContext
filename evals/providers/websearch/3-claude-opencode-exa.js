/**
 * Provider 3: Claude + Exa /answer API (direct, no MCP subprocess).
 *
 * Calls api.exa.ai/answer directly using EXA_API_KEY — returns a
 * synthesized answer + citations in a single tool call.
 * Requires EXA_API_KEY in env or .env.local.
 */

import {
  loadEnv,
  requireEnv,
  buildResult,
  callAnthropicAgentic,
  cachedExaAnswer,
} from "./shared.js";

loadEnv();

const MODEL = process.env.ANTHROPIC_WEB_EVAL_MODEL ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5-20251001";

const SYSTEM =
  "You are a research assistant. " +
  "You have access to the exa_answer tool which returns a synthesized answer with citations — " +
  "use it to look up current information. " +
  "You do NOT have native web search capability; only the provided tools may fetch web data. " +
  "Use the tool result to compose your final answer, citing the sources provided.";

const TOOLS = [
  {
    name: "exa_answer",
    description:
      "Synthesized answer with citations from Exa's /answer API. " +
      "Returns a direct answer + source list instead of raw page content.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Question or search query" } },
      required: ["query"],
    },
  },
];

async function callExaAnswer(query) {
  const apiKey = requireEnv("EXA_API_KEY");
  const res = await fetch("https://api.exa.ai/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, text: true }),
  });
  if (!res.ok) throw new Error(`Exa /answer ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const answer = json.answer ?? "";
  const sources = (json.sources ?? [])
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
    .join("\n");
  return sources ? `${answer}\n\nSources:\n${sources}` : answer;
}

export default class ClaudeExaDirectProvider {
  id() {
    return "claude-exa-direct";
  }

  async callApi(prompt) {
    const start = Date.now();

    const { output, promptTokens, completionTokens, toolCallCount, modelRounds, toolsUsed } =
      await callAnthropicAgentic({
        prompt,
        system: SYSTEM,
        tools: TOOLS,
        executeTool: async (_name, input) => cachedExaAnswer(input.query, () => callExaAnswer(input.query)),
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
      searchProvider: "exa-answer-direct",
      toolsUsed,
    });
  }
}
