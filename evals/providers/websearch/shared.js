/**
 * Shared utilities for web-search eval providers.
 *
 * Each provider builds on callAnthropicAgentic() which runs a standard
 * multi-turn Claude loop. Providers inject their own tools and executeTool()
 * function — the rest of the loop, token tracking, and result shaping is
 * handled here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENV_FILES = [resolve(REPO_ROOT, ".env.local"), resolve(REPO_ROOT, ".env")];

// ── env bootstrap ────────────────────────────────────────────────────────────

export function loadEnv() {
  for (const envPath of ENV_FILES) {
    if (!existsSync(envPath)) continue;
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.indexOf("=");
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      if (!key || process.env[key]) continue;
      let val = line.slice(sep + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

export function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ── result builder ───────────────────────────────────────────────────────────

/**
 * Build a standard promptfoo provider result.
 * Exposes all searchable/comparable fields in metadata so the promptfoo
 * comparison table can surface them.
 */
export function buildResult({
  output,
  model,
  promptTokens,
  completionTokens,
  toolCallCount,
  modelRounds,
  totalMs,
  searchProvider,
  toolsUsed = [],
  metadata = {},
}) {
  return {
    output,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    metadata: {
      model,
      searchProvider,
      toolCallCount,
      toolsUsed,
      modelRounds,
      totalMs,
      ...metadata,
    },
  };
}

// ── http ─────────────────────────────────────────────────────────────────────

export async function fetchWithRetry(url, init, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && i < retries - 1) {
        await sleep(800 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await sleep(800 * (i + 1));
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

// ── Anthropic agentic loop ───────────────────────────────────────────────────

const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * Runs a multi-turn Claude conversation with custom tools.
 *
 * @param {object} opts
 * @param {string}   opts.prompt
 * @param {string}   opts.system
 * @param {Array}    opts.tools      - Anthropic-format tool defs (name / description / input_schema)
 *                                    OR native tool object {type, name, ...}
 * @param {Function} opts.executeTool - async (name, input) => string
 * @param {object}   opts.extraHeaders - extra HTTP headers (e.g. anthropic-beta)
 * @param {number}   opts.maxRounds
 * @param {string}   opts.model
 * @param {string}   opts.apiKey
 */
export async function callAnthropicAgentic({
  prompt,
  system,
  tools = [],
  executeTool = async () => "",
  extraHeaders = {},
  maxRounds = 8,
  model,
  apiKey,
}) {
  const proxyBaseUrl = (process.env.PROXY_BASE_URL ?? "").replace(/\/$/, "");
  const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL ?? "").replace(/\/$/, "");
  const apiBaseUrl = proxyBaseUrl || anthropicBaseUrl;
  const apiUrl = apiBaseUrl ? `${apiBaseUrl}/v1/messages` : DEFAULT_ANTHROPIC_URL;
  const resolvedModel =
    model ??
    process.env.ANTHROPIC_WEB_EVAL_MODEL ??
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ??
    "claude-haiku-4-5-20251001";
  const resolvedKey =
    apiKey ??
    (proxyBaseUrl ? process.env.PROXY_API_KEY : null) ??
    requireEnv("ANTHROPIC_API_KEY");
  const headers = proxyBaseUrl
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedKey}`,
        ...extraHeaders,
      }
    : {
        "Content-Type": "application/json",
        "x-api-key": resolvedKey,
        "anthropic-version": "2023-06-01",
        ...extraHeaders,
      };

  const messages = [{ role: "user", content: prompt }];
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCallCount = 0;
  let modelRounds = 0;
  const toolsUsed = [];

  for (let i = 0; i < maxRounds; i++) {
    const res = await fetchWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 4096,
        temperature: 0,
        system,
        tools: tools.length ? tools : undefined,
        messages,
      }),
    });

    modelRounds++;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = await res.json();
    promptTokens += json.usage?.input_tokens ?? 0;
    completionTokens += json.usage?.output_tokens ?? 0;

    const content = json.content ?? [];
    const toolUses = content.filter((c) => c.type === "tool_use");

    if (toolUses.length === 0 || json.stop_reason === "end_turn") {
      const output = extractText(content);
      return { output, promptTokens, completionTokens, toolCallCount, modelRounds, toolsUsed };
    }

    // Append assistant turn
    messages.push({ role: "assistant", content });

    // Execute tools and collect results
    const toolResults = [];
    for (const tu of toolUses) {
      toolCallCount++;
      toolsUsed.push(tu.name);
      let resultContent;
      try {
        resultContent = await executeTool(tu.name, tu.input ?? {});
      } catch (e) {
        resultContent = `Error executing ${tu.name}: ${e.message}`;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: String(resultContent ?? ""),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Anthropic agentic loop hit maxRounds=${maxRounds}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function extractText(content) {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/** Convert MCP tool list → Anthropic tool definitions */
export function mcpToolsToAnthropic(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Exa answer cache ─────────────────────────────────────────────────────────
// File-based cache for Exa /answer calls. Keyed by SHA-256(query).
// Stored at evals/.promptfoo/exa-answer-cache.json — persists across runs so
// repeated smoke tests don't re-hit the API with identical queries.

const CACHE_FILE = resolve(REPO_ROOT, "evals/.promptfoo/exa-answer-cache.json");

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // non-fatal — cache write failure just means next run re-fetches
  }
}

/**
 * Wrap an async Exa /answer fetch with file-based caching.
 * @param {string} query
 * @param {() => Promise<string>} fetcher
 * @returns {Promise<string>}
 */
export async function cachedExaAnswer(query, fetcher) {
  const key = createHash("sha256").update(query.trim().toLowerCase()).digest("hex").slice(0, 16);
  const cache = readCache();
  if (cache[key]) {
    process.stderr.write(`[exa-cache] HIT  ${key} "${query.slice(0, 60)}"\n`);
    return cache[key];
  }
  process.stderr.write(`[exa-cache] MISS ${key} "${query.slice(0, 60)}"\n`);
  const result = await fetcher();
  cache[key] = result;
  writeCache(cache);
  return result;
}
