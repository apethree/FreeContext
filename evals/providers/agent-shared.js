import { loadLocalEnv } from "../scripts/load-local-env.js";

loadLocalEnv();

const DEFAULT_MCP_ENDPOINT = "http://127.0.0.1:3214/mcp";

const MODEL_PRICING = {
  "gpt-5.4-mini": { input: 0.2, output: 0.8, cacheRead: 0.1 },
  "gpt-5.4": { input: 1.25, output: 10.0, cacheRead: 0.625 },
  "gpt-5.2": { input: 1.0, output: 8.0, cacheRead: 0.5 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-opus-4-6": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
};

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function resolveEvalEndpoint(override) {
  return (
    override ??
    process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
    process.env.MCP_SERVER_URL ??
    DEFAULT_MCP_ENDPOINT
  );
}

export function estimateCost(
  model,
  promptTokens,
  completionTokens,
  { cacheWriteTokens = 0, cacheReadTokens = 0 } = {}
) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return null;
  }

  return (
    promptTokens * pricing.input +
    completionTokens * pricing.output +
    cacheWriteTokens * (pricing.cacheWrite ?? pricing.input) +
    cacheReadTokens * (pricing.cacheRead ?? 0)
  ) / 1_000_000;
}

export function buildProviderResult({ output, model, usage, metadata }) {
  const promptTokens = usage?.prompt ?? 0;
  const completionTokens = usage?.completion ?? 0;
  const cacheWriteTokens = usage?.cacheWrite ?? 0;
  const cacheReadTokens = usage?.cacheRead ?? 0;
  const totalTokens = usage?.total ?? (promptTokens + completionTokens);

  const actualCost = usage?.actualCostUsd ?? null;
  const estimatedCost = estimateCost(model, promptTokens, completionTokens, {
    cacheWriteTokens,
    cacheReadTokens,
  });
  const cost = actualCost ?? estimatedCost;

  return {
    output,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
      ...(cacheWriteTokens > 0 ? { cacheWrite: cacheWriteTokens } : {}),
      ...(cacheReadTokens > 0 ? { cacheRead: cacheReadTokens } : {}),
      ...(cost != null ? { cost } : {}),
    },
    metadata: {
      model,
      ...(cost != null ? { costUsd: cost, costSource: actualCost != null ? "api" : "estimate" } : {}),
      ...metadata,
    },
  };
}
