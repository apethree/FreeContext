/**
 * Provider 6: OpenRouter free models with web search.
 *
 * Two activation modes (auto-detected from model slug):
 *   :online suffix  – web search baked into the model slug; no plugins config needed.
 *                     e.g. "minimax/minimax-m2.5:free:online"
 *   plugin config   – explicit plugins array sent with the request.
 *                     e.g. "nvidia/nemotron-3-super-120b-a12b:free" + webEngine: "exa"
 *
 * Configured via promptfoo config vars:
 *   model       – OpenRouter model ID
 *   webEngine   – "exa" | "native" | "firecrawl" | "parallel" (default: "exa", ignored for :online)
 *   maxResults  – number of web results (default: 5, ignored for :online)
 */

import { loadEnv, requireEnv, buildResult, sleep } from "./shared.js";

loadEnv();

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM =
  "You are a research assistant. Web search results are automatically injected into your context. " +
  "Answer based solely on those results. " +
  "Do NOT generate tool calls, function calls, XML invocations, or API calls of any kind — " +
  "not even for npm, MCP, or any other service. " +
  "If the web results are insufficient, say so in plain text.";

export default class OpenRouterWebProvider {
  constructor(options = {}) {
    this._model = options.model ?? "minimax/minimax-m2.5:free";
    this._webEngine = options.webEngine ?? "exa";
    this._maxResults = Number(options.maxResults ?? 5);
  }

  id() {
    return `openrouter-${this._model.replace(/[/:]/g, "-")}-${this._webEngine}`;
  }

  async callApi(prompt, context) {
    // promptfoo passes config vars via context.vars or provider options
    const model = context?.vars?.model ?? this._model;
    const webEngine = context?.vars?.webEngine ?? this._webEngine;
    const maxResults = Number(context?.vars?.maxResults ?? this._maxResults);

    const start = Date.now();
    const apiKey = requireEnv("OPENROUTER_API_KEY");

    // :online models have web search baked in — no plugins config needed.
    // Explicit plugin config is used for non-:online models (e.g. nemotron).
    const isOnline = model.endsWith(":online");
    const body = {
      model,
      ...(isOnline
        ? { tool_choice: "none" }  // block tool-call XML leakage from training
        : { plugins: [{ id: "web", engine: webEngine, max_results: maxResults }] }),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    };

    // Free-tier providers 429 frequently — retry with backoff
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(3000 * attempt);
      res = await fetch(OR_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/FreeContext/evals",
          "X-Title": "FreeContext web-search eval",
        },
        body: JSON.stringify(body),
      });
      if (res.status !== 429) break;
    }

    const totalMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = await res.json();
    const output = json.choices?.[0]?.message?.content ?? "";
    const usage = json.usage ?? {};

    return buildResult({
      output,
      model,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      toolCallCount: 0,   // web plugin is transparent — no tool_use counted
      modelRounds: 1,
      totalMs,
      searchProvider: isOnline ? "openrouter-online" : `openrouter-${webEngine}`,
      toolsUsed: [isOnline ? "web:online" : `web:${webEngine}`],
      metadata: isOnline ? { mode: "online" } : { webEngine, maxResults },
    });
  }
}
