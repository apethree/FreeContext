import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const OLLAMA_API_URL = process.env.OLLAMA_API_URL ?? "http://127.0.0.1:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";
const MCP_ENDPOINT =
  process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
  process.env.MCP_SERVER_URL ??
  "http://127.0.0.1:3211/mcp";
const TOOL_LOOP_LIMIT = Number(process.env.FREE_CONTEXT_EVAL_TOOL_LOOP_LIMIT ?? "10");

const RAW_SYSTEM_PROMPT =
  "You are answering a code-intelligence question about the FreeContext repository. " +
  "No external tools are available to you. " +
  "Do not claim to search files, read files, call tools, or inspect repository state unless that information is explicitly present in the prompt. " +
  "Answer directly from what you truly know.";

const TOOL_SYSTEM_PROMPT =
  "You are answering a code-intelligence question about the FreeContext repository. " +
  "Use FreeContext tools when they are available. " +
  "Only use real tool calls; never simulate tool calls or tool outputs in plain text. " +
  "After using tools, you must answer in normal prose in assistant content. " +
  "Name exact file paths and concrete method names.";

export async function callOllamaRaw(prompt) {
  const json = await ollamaChat({
    messages: [
      { role: "system", content: RAW_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  return buildProviderResult({
    output: json.message?.content ?? "",
    usage: usageFromOllama(json),
    metadata: {
      provider: "ollama",
      model: OLLAMA_MODEL,
      hasTools: false,
      toolCount: 0,
      toolsUsed: [],
      toolLoopIterations: 0,
      modelRounds: 1,
      modelLatencyMs: durationMs(json.total_duration),
      toolLatencyMs: 0,
      simulatedToolMarkup: false,
    },
  });
}

export async function callOllamaWithFreeContext(prompt, endpoint = MCP_ENDPOINT) {
  const client = new Client({ name: "promptfoo-ollama-freecontext", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

  try {
    const tools = toOllamaTools((await client.listTools()).tools);
    const messages = [
      { role: "system", content: TOOL_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];
    const toolNames = [];
    const toolTrace = [];
    let toolCount = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let modelLatencyMs = 0;
    let toolLatencyMs = 0;

    for (let i = 0; i < TOOL_LOOP_LIMIT; i += 1) {
      const json = await ollamaChat({ messages, tools });
      promptTokens += json.prompt_eval_count ?? 0;
      completionTokens += json.eval_count ?? 0;
      modelLatencyMs += durationMs(json.total_duration);

      const message = json.message ?? {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (toolCalls.length === 0) {
        if (toolCount > 0 && !(message.content ?? "").trim()) {
          messages.push({
            role: "user",
            content: "You have already used real tools. Answer now in normal prose only. Do not call more tools.",
          });
          const finalJson = await ollamaChat({ messages });
          promptTokens += finalJson.prompt_eval_count ?? 0;
          completionTokens += finalJson.eval_count ?? 0;
          modelLatencyMs += durationMs(finalJson.total_duration);

          return buildProviderResult({
            output: finalJson.message?.content ?? "",
            usage: {
              prompt: promptTokens,
              completion: completionTokens,
              total: promptTokens + completionTokens,
            },
            metadata: {
              provider: "ollama",
              model: OLLAMA_MODEL,
              endpoint,
              hasTools: true,
              toolCount,
              toolsUsed: [...new Set(toolNames)],
              toolLoopIterations: i,
              modelRounds: i + 2,
              modelLatencyMs,
              toolLatencyMs,
              toolTrace,
              forcedFinalAnswer: true,
              finalReason: "empty_final_content",
              simulatedToolMarkup: false,
            },
          });
        }

        return buildProviderResult({
          output: message.content ?? "",
          usage: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          },
          metadata: {
            provider: "ollama",
            model: OLLAMA_MODEL,
            endpoint,
            hasTools: true,
            toolCount,
            toolsUsed: [...new Set(toolNames)],
            toolLoopIterations: i,
            modelRounds: i + 1,
            modelLatencyMs,
            toolLatencyMs,
            toolTrace,
            simulatedToolMarkup: false,
          },
        });
      }

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        toolCount += 1;
        const toolName = toolCall.function?.name ?? "unknown_tool";
        const toolArgs = toolCall.function?.arguments ?? {};
        toolNames.push(toolName);
        const toolStartedAt = Date.now();
        const result = await client.callTool({ name: toolName, arguments: toolArgs });
        toolLatencyMs += Date.now() - toolStartedAt;
        const payload = summarizeStructuredContent(result.structuredContent);
        toolTrace.push({ name: toolName, args: toolArgs, resultPreview: payload });
        messages.push({
          role: "tool",
          content: JSON.stringify(payload ?? {}),
        });
      }
    }

    throw new Error(`Ollama FreeContext eval hit the tool loop limit (${TOOL_LOOP_LIMIT}).`);
  } finally {
    await client.close();
  }
}

async function ollamaChat({ messages, tools }) {
  const response = await fetch(OLLAMA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama eval failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function toOllamaTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeInputSchema(tool.name, tool.inputSchema),
    },
  }));
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

function usageFromOllama(json) {
  const prompt = json.prompt_eval_count ?? 0;
  const completion = json.eval_count ?? 0;
  return {
    prompt,
    completion,
    total: prompt + completion,
  };
}

function durationMs(ns) {
  return typeof ns === "number" ? Math.round(ns / 1_000_000) : 0;
}

function buildProviderResult({ output, usage, metadata }) {
  return {
    output,
    tokenUsage: usage,
    metadata,
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
