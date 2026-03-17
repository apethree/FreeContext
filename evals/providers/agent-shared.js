import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PROVIDERS_DIR, "..", "..");
const LOCAL_ENV_FILES = [
  resolve(REPO_ROOT, ".env.local"),
  resolve(REPO_ROOT, ".env"),
];

bootstrapLocalEnv();

// All 10 FreeContext MCP tools are read-only index queries — always permitted.
const FREECONTEXT_READONLY_TOOLS = new Set([
  "search_code",
  "search_paths",
  "find_symbol",
  "get_symbol",
  "list_file_symbols",
  "who_calls",
  "what_does_this_call",
  "recently_changed_symbols",
  "reindex",
  "codebase_map",
]);

// Only files under this directory may be targeted by any non-read-only tool.
const FIXTURES_DIR = resolve(PROVIDERS_DIR, "..", "fixtures");

/**
 * Throws if a tool call that isn't in the read-only allowlist targets a path
 * outside evals/fixtures/. This ensures eval runs can never touch source files
 * even if a write-capable tool is added in the future.
 */
function assertFixtureSafe(toolName, args) {
  if (FREECONTEXT_READONLY_TOOLS.has(toolName)) {
    return; // index query — always safe
  }
  const pathArgs = ["filePath", "path", "file", "target", "destination", "output"];
  for (const key of pathArgs) {
    const value = args?.[key];
    if (typeof value !== "string") continue;
    const absolute = resolve(value);
    if (!absolute.startsWith(FIXTURES_DIR + "/") && absolute !== FIXTURES_DIR) {
      throw new Error(
        `Eval safety: tool "${toolName}" targeted "${value}" which is outside ` +
        `evals/fixtures/. Only fixture files may be written during evals.`
      );
    }
  }
}

const OPENAI_API_URL = process.env.PROXY_BASE_URL
  ? `${process.env.PROXY_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`
  : (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/chat/completions");
const ANTHROPIC_API_URL = process.env.PROXY_BASE_URL
  ? `${process.env.PROXY_BASE_URL.replace(/\/$/, "")}/v1/messages`
  : (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1/messages");
const OPENAI_MODEL = process.env.OPENAI_AGENT_EVAL_MODEL ?? "gpt-5-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_AGENT_EVAL_MODEL ?? "claude-sonnet-4-6";
const TOOL_LOOP_LIMIT = Number(process.env.FREE_CONTEXT_EVAL_TOOL_LOOP_LIMIT ?? "10");
const FORCE_FINAL_ANSWER = process.env.FREE_CONTEXT_EVAL_FORCE_FINAL_ANSWER === "1";
const FINAL_ANSWER_TOOL_ROUND_LIMIT = Number(process.env.FREE_CONTEXT_EVAL_FINAL_ANSWER_ROUND_LIMIT ?? "4");
const PROVIDER_FETCH_RETRIES = Number(process.env.FREE_CONTEXT_EVAL_PROVIDER_FETCH_RETRIES ?? "6");
const RAW_SYSTEM_PROMPT =
  "You are answering a code-intelligence question about the FreeContext repository. " +
  "No external tools are available to you. " +
  "Do not claim to search files, read files, call tools, or inspect repository state unless that information is explicitly present in the prompt. " +
  "Do not output fake tool markup such as <tool_call> or <tool_response>. " +
  "Answer directly from what you truly know.";
const TOOL_SYSTEM_PROMPT =
  "You are answering a code-intelligence question about the FreeContext repository. " +
  "Use FreeContext tools when they are available. " +
  "Only use real tool calls; never simulate tool calls or tool outputs in plain text. " +
  "When the task names a concrete file path or a directory such as evals/fixtures/, first verify it with search_paths and keep subsequent lookups scoped to that path. " +
  "For fixture edit tasks, do not switch to src/ files unless a tool result explicitly proves the fixture path is missing. " +
  "Prefer path-scoped queries under evals/fixtures/ when the task targets fixture files. " +
  "When the task asks for exact current line(s), use search_code with a symbol name or code fragment from the task, then call get_symbol on the returned id to quote the real source text verbatim, including modifiers such as export or private. " +
  "Never use a file path, punctuation-only string, or comment marker as the search_code query. " +
  "Always return a final prose answer after tool use. " +
  "Name exact file paths and concrete method names. " +
  "Do not output raw tool call JSON.";

function bootstrapLocalEnv() {
  for (const envPath of LOCAL_ENV_FILES) {
    if (!existsSync(envPath)) {
      continue;
    }

    const source = readFileSync(envPath, "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key]) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveOpenAiApiKey(override) {
  return override ?? process.env.OPENAI_API_KEY ?? process.env.PROXY_API_KEY ?? "";
}

function resolveAnthropicApiKey() {
  return process.env.ANTHROPIC_API_KEY ?? process.env.PROXY_API_KEY ?? "";
}

function buildAnthropicHeaders(apiKey) {
  if (process.env.PROXY_BASE_URL) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

// overrides: { apiUrl?, model?, apiKey?, providerLabel? }
export async function callOpenAiRaw(prompt, overrides = {}) {
  const apiUrl = overrides.apiUrl ?? OPENAI_API_URL;
  const model = overrides.model ?? OPENAI_MODEL;
  const apiKey = resolveOpenAiApiKey(overrides.apiKey) || requireEnv("OPENAI_API_KEY");
  const response = await fetchWithRetry(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: RAW_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`${overrides.providerLabel ?? "OpenAI"} raw eval failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return buildProviderResult({
    output: json.choices?.[0]?.message?.content ?? "",
    model,
    usage: {
      prompt: json.usage?.prompt_tokens,
      completion: json.usage?.completion_tokens,
      total: json.usage?.total_tokens,
    },
    metadata: {
      provider: "openai",
      hasTools: false,
      toolCount: 0,
      toolsUsed: [],
      toolLoopIterations: 0,
      simulatedToolMarkup: containsFakeToolMarkup(json.choices?.[0]?.message?.content ?? ""),
    },
  });
}

export async function callAnthropicRaw(prompt) {
  const apiKey = resolveAnthropicApiKey() || requireEnv("ANTHROPIC_API_KEY");
  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: "POST",
    headers: buildAnthropicHeaders(apiKey),
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: RAW_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic raw eval failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  const output = extractAnthropicText(json.content);
  return buildProviderResult({
    output,
    model: ANTHROPIC_MODEL,
    usage: {
      prompt: json.usage?.input_tokens,
      completion: json.usage?.output_tokens,
      total: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
    },
    metadata: {
      provider: "anthropic",
      hasTools: false,
      toolCount: 0,
      toolsUsed: [],
      toolLoopIterations: 0,
      simulatedToolMarkup: containsFakeToolMarkup(output),
    },
  });
}

// overrides: { apiUrl?, model?, apiKey?, providerLabel? }
export async function callOpenAiWithFreeContext(prompt, endpoint, overrides = {}) {
  endpoint = resolveEvalEndpoint(endpoint);
  const apiUrl = overrides.apiUrl ?? OPENAI_API_URL;
  const model = overrides.model ?? OPENAI_MODEL;
  const apiKey = resolveOpenAiApiKey(overrides.apiKey) || requireEnv("OPENAI_API_KEY");
  const compactToolResults = overrides.compactToolResults ?? true;
  const client = new Client({ name: "promptfoo-openai-freecontext", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

  try {
    const tools = toOpenAiTools((await client.listTools()).tools);
    const toolNames = [];
    const toolTrace = [];
    let toolCount = 0;
    let duplicateToolRoundStreak = 0;
    let modelLatencyMs = 0;
    let toolLatencyMs = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    const seenToolSignatures = new Map();
    const messages = [
      { role: "system", content: TOOL_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    for (let i = 0; i < TOOL_LOOP_LIMIT; i++) {
      const modelStartedAt = Date.now();
      const response = await fetchWithRetry(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 2048,
          messages,
          tools,
          tool_choice: toolCount === 0 ? "required" : "auto",
        }),
      });
      modelLatencyMs += Date.now() - modelStartedAt;

      if (!response.ok) {
        throw new Error(`OpenAI FreeContext eval failed: ${response.status} ${await response.text()}`);
      }

      const json = await response.json();
      promptTokens += json.usage?.prompt_tokens ?? 0;
      completionTokens += json.usage?.completion_tokens ?? 0;
      const message = json.choices?.[0]?.message;
      if (!message) {
        throw new Error("OpenAI FreeContext eval returned no message.");
      }

      if (!message.tool_calls?.length) {
        if (toolCount > 0 && !(message.content ?? "").trim()) {
          messages.push({
            role: "user",
            content:
              "You have already used real tools. Answer now using the gathered tool results only. Do not call more tools.",
          });
          return finalizeOpenAiAnswer({
            apiUrl,
            model,
            apiKey,
            messages,
            promptTokens,
            completionTokens,
            modelLatencyMs,
            toolLatencyMs,
            toolCount,
            toolRounds: i,
            toolNames,
            toolTrace,
            endpoint,
            finalReason: "empty_final_content",
          });
        }

        return buildProviderResult({
          output: message.content ?? "",
          model,
          usage: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          },
          metadata: {
            provider: "openai",
            hasTools: true,
            endpoint,
            toolCount,
            toolsUsed: [...new Set(toolNames)],
            toolLoopIterations: i,
            modelRounds: i + 1,
            modelLatencyMs,
            toolLatencyMs,
            toolTrace,
            simulatedToolMarkup: containsFakeToolMarkup(message.content ?? ""),
          },
        });
      }

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      });

      let roundRepeatedOnly = true;
      for (const toolCall of message.tool_calls) {
        toolCount += 1;
        toolNames.push(toolCall.function.name);
        const toolArgs = safeParseArgs(toolCall.function.arguments);
        const toolSignature = buildToolCallSignature(toolCall.function.name, toolArgs);
        const previousSignatureCount = seenToolSignatures.get(toolSignature) ?? 0;
        seenToolSignatures.set(toolSignature, previousSignatureCount + 1);
        if (previousSignatureCount === 0) {
          roundRepeatedOnly = false;
        }
        assertFixtureSafe(toolCall.function.name, toolArgs);
        const toolStartedAt = Date.now();
        const result = await client.callTool({
          name: toolCall.function.name,
          arguments: toolArgs,
        });
        toolLatencyMs += Date.now() - toolStartedAt;
        toolTrace.push({
          name: toolCall.function.name,
          args: toolArgs,
          resultPreview: summarizeStructuredContent(result.structuredContent),
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(buildToolMessagePayload(result.structuredContent, compactToolResults)),
        });
      }

      if (roundRepeatedOnly) {
        duplicateToolRoundStreak += 1;
        messages.push({
          role: "user",
          content:
            "You have already called the same tool with the same arguments and already have that result. " +
            "Do not repeat identical tool calls. Answer now unless you need a different tool or different arguments.",
        });
      } else {
        duplicateToolRoundStreak = 0;
      }

      if (FORCE_FINAL_ANSWER && toolCount > 0 && i + 1 >= FINAL_ANSWER_TOOL_ROUND_LIMIT) {
        messages.push({
          role: "user",
          content:
            "You have enough real tool evidence. Answer now using the gathered tool results only. Do not call more tools.",
        });
        return finalizeOpenAiAnswer({
          apiUrl,
          model,
          apiKey,
          messages,
          promptTokens,
          completionTokens,
          modelLatencyMs,
          toolLatencyMs,
          toolCount,
          toolRounds: i + 1,
          toolNames,
          toolTrace,
          endpoint,
          finalReason: "tool_round_limit",
        });
      }
    }

    throw new Error(
      `OpenAI FreeContext eval hit the tool loop limit (${TOOL_LOOP_LIMIT}). ` +
      `toolsUsed=${[...new Set(toolNames)].join(",") || "-"} ` +
      `toolCount=${toolCount} duplicateToolRoundStreak=${duplicateToolRoundStreak} ` +
      `lastToolTrace=${JSON.stringify(toolTrace.slice(-3))}`
    );
  } finally {
    await client.close();
  }
}

export async function callAnthropicWithFreeContext(prompt, endpoint) {
  endpoint = resolveEvalEndpoint(endpoint);
  const apiKey = resolveAnthropicApiKey() || requireEnv("ANTHROPIC_API_KEY");
  const compactToolResults = true;
  const client = new Client({ name: "promptfoo-anthropic-freecontext", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

  try {
    const tools = toAnthropicTools((await client.listTools()).tools);
    const toolNames = [];
    const toolTrace = [];
    let toolCount = 0;
    let modelLatencyMs = 0;
    let toolLatencyMs = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    const messages = [
      {
        role: "user",
        content: prompt,
      },
    ];

    for (let i = 0; i < TOOL_LOOP_LIMIT; i++) {
      const modelStartedAt = Date.now();
      const response = await fetchWithRetry(ANTHROPIC_API_URL, {
        method: "POST",
        headers: buildAnthropicHeaders(apiKey),
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 2048,
          temperature: 0,
          system: TOOL_SYSTEM_PROMPT,
          tools,
          tool_choice: i === 0 ? { type: "any" } : { type: "auto" },
          messages,
        }),
      });
      modelLatencyMs += Date.now() - modelStartedAt;

      if (!response.ok) {
        throw new Error(`Anthropic FreeContext eval failed: ${response.status} ${await response.text()}`);
      }

      const json = await response.json();
      promptTokens += json.usage?.input_tokens ?? 0;
      completionTokens += json.usage?.output_tokens ?? 0;
      const content = json.content ?? [];
      const toolUses = content.filter((item) => item.type === "tool_use");
      if (toolUses.length === 0) {
        const output = extractAnthropicText(content);
        return buildProviderResult({
          output,
          model: ANTHROPIC_MODEL,
          usage: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          },
          metadata: {
            provider: "anthropic",
            hasTools: true,
            endpoint,
            toolCount,
            toolsUsed: [...new Set(toolNames)],
            toolLoopIterations: i,
            modelRounds: i + 1,
            modelLatencyMs,
            toolLatencyMs,
            toolTrace,
            simulatedToolMarkup: containsFakeToolMarkup(output),
          },
        });
      }

      messages.push({
        role: "assistant",
        content,
      });

      const toolResults = [];
      for (const toolUse of toolUses) {
        toolCount += 1;
        toolNames.push(toolUse.name);
        assertFixtureSafe(toolUse.name, toolUse.input ?? {});
        const toolStartedAt = Date.now();
        const result = await client.callTool({
          name: toolUse.name,
          arguments: toolUse.input ?? {},
        });
        toolLatencyMs += Date.now() - toolStartedAt;
        toolTrace.push({
          name: toolUse.name,
          args: toolUse.input ?? {},
          resultPreview: summarizeStructuredContent(result.structuredContent),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(buildToolMessagePayload(result.structuredContent, compactToolResults)),
        });
      }

      messages.push({
        role: "user",
        content: toolResults,
      });

      if (FORCE_FINAL_ANSWER && toolCount > 0 && i + 1 >= FINAL_ANSWER_TOOL_ROUND_LIMIT) {
        messages.push({
          role: "user",
          content:
            "You have enough real tool evidence. Answer now using the gathered tool results only. Do not call more tools.",
        });
        return finalizeAnthropicAnswer({
          apiKey,
          messages,
          promptTokens,
          completionTokens,
          modelLatencyMs,
          toolLatencyMs,
          toolCount,
          toolRounds: i + 1,
          toolNames,
          toolTrace,
          endpoint,
        });
      }
    }

    throw new Error(`Anthropic FreeContext eval hit the tool loop limit (${TOOL_LOOP_LIMIT}).`);
  } finally {
    await client.close();
  }
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: augmentDescription(tool.name, tool.description),
      parameters: sanitizeInputSchema(tool.name, tool.inputSchema),
    },
  }));
}

function toAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: augmentDescription(tool.name, tool.description),
    input_schema: sanitizeInputSchema(tool.name, tool.inputSchema),
  }));
}

function augmentDescription(name, description = "") {
  if (name === "search_code") {
    return `${description} Prefer fulltext retrieval for these evals. Do not request semantic or hybrid mode. The query must be a symbol name or exact code fragment from the task, not a file path or punctuation. This tool returns matching symbol ids; for exact source lines, follow up with get_symbol on the chosen id.`;
  }
  if (name === "search_paths") {
    return `${description} When the user names a file path, query by basename and keep pathPrefix under the named directory.`;
  }
  if (name === "find_symbol") {
    return `${description} Prefer symbols found under evals/fixtures/ when the task explicitly targets fixture files.`;
  }
  if (name === "get_symbol" || name === "list_file_symbols") {
    return `${description} get_symbol includes rawText for the exact symbol. Use it after search_code or find_symbol when you need verbatim current lines.`;
  }
  return description;
}

function sanitizeInputSchema(name, schema = { type: "object", properties: {} }) {
  const copy = structuredClone(schema);
  if (name === "search_code" && copy?.properties?.mode) {
    delete copy.properties.mode;
  }
  if (Array.isArray(copy?.required)) {
    copy.required = copy.required.filter((item) => item !== "mode");
  }
  return copy;
}

function extractAnthropicText(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function resolveEvalEndpoint(override) {
  return (
    override ??
    process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
    process.env.MCP_SERVER_URL ??
    "http://127.0.0.1:3214/mcp"
  );
}

function safeParseArgs(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function containsFakeToolMarkup(output) {
  return output.includes("<tool_call>") || output.includes("<tool_response>");
}

async function fetchWithRetry(input, init, retries = PROVIDER_FETCH_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if ((response.status === 429 || response.status >= 500) && attempt < retries - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}

function backoffMs(attempt) {
  return Math.min(8_000, 1_000 * 2 ** attempt);
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function buildToolCallSignature(name, args) {
  return `${name}:${stableJson(args ?? {})}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function finalizeOpenAiAnswer({
  apiUrl,
  model,
  apiKey,
  messages,
  promptTokens,
  completionTokens,
  modelLatencyMs,
  toolLatencyMs,
  toolCount,
  toolRounds,
  toolNames,
  toolTrace,
  endpoint,
  finalReason = "explicit_final_answer",
}) {
  const startedAt = Date.now();
  const response = await fetchWithRetry(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2048,
      messages,
    }),
  });
  modelLatencyMs += Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(`OpenAI FreeContext final answer failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  promptTokens += json.usage?.prompt_tokens ?? 0;
  completionTokens += json.usage?.completion_tokens ?? 0;
  const output = json.choices?.[0]?.message?.content ?? "";

  return buildProviderResult({
    output,
    model,
    usage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    metadata: {
      provider: "openai",
      hasTools: true,
      endpoint,
      toolCount,
      toolsUsed: [...new Set(toolNames)],
      toolLoopIterations: toolRounds,
      modelRounds: toolRounds + 1,
      modelLatencyMs,
      toolLatencyMs,
      toolTrace,
      forcedFinalAnswer: true,
      finalReason,
      simulatedToolMarkup: containsFakeToolMarkup(output),
    },
  });
}

async function finalizeAnthropicAnswer({
  apiKey,
  messages,
  promptTokens,
  completionTokens,
  modelLatencyMs,
  toolLatencyMs,
  toolCount,
  toolRounds,
  toolNames,
  toolTrace,
  endpoint,
}) {
  const startedAt = Date.now();
  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: "POST",
    headers: buildAnthropicHeaders(apiKey),
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: TOOL_SYSTEM_PROMPT,
      messages,
    }),
  });
  modelLatencyMs += Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(`Anthropic FreeContext final answer failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  promptTokens += json.usage?.input_tokens ?? 0;
  completionTokens += json.usage?.output_tokens ?? 0;
  const output = extractAnthropicText(json.content ?? []);

  return buildProviderResult({
    output,
    model: ANTHROPIC_MODEL,
    usage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    metadata: {
      provider: "anthropic",
      hasTools: true,
      endpoint,
      toolCount,
      toolsUsed: [...new Set(toolNames)],
      toolLoopIterations: toolRounds,
      modelRounds: toolRounds + 1,
      modelLatencyMs,
      toolLatencyMs,
      toolTrace,
      forcedFinalAnswer: true,
      simulatedToolMarkup: containsFakeToolMarkup(output),
    },
  });
}

function buildProviderResult({ output, model, usage, metadata }) {
  const promptTokens = usage?.prompt ?? 0;
  const completionTokens = usage?.completion ?? 0;
  const totalTokens = usage?.total ?? (promptTokens + completionTokens);
  return {
    output,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
    },
    metadata: {
      model,
      ...metadata,
    },
  };
}

function summarizeStructuredContent(value) {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  if (Array.isArray(value.results)) {
    return {
      count: value.count ?? value.results.length,
      results: value.results.slice(0, 3),
    };
  }

  if ("symbol" in value) {
    return {
      symbol: value.symbol,
    };
  }

  return value;
}

function buildToolMessagePayload(value, compact) {
  if (!compact) {
    return value ?? {};
  }
  return summarizeStructuredContent(value);
}
