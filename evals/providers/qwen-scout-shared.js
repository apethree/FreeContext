import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildProviderResult, requireEnv, resolveEvalEndpoint } from "./agent-shared.js";
import { resolveScoutRuntime } from "./scout-models.js";
import { withChildSpan } from "./braintrust-shared.js";

const execFileAsync = promisify(execFile);
const MAX_TOOL_TURNS = Number(process.env.FREE_CONTEXT_SCOUT_MAX_TURNS ?? "12");
const MAX_SEARCH_RESULTS = 8;
const MAX_FILE_LINES = 160;
const MAX_OUTPUT_CHARS = 16_000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function trimOutput(value, limit = MAX_OUTPUT_CHARS) {
  const stringValue = String(value ?? "");
  if (stringValue.length <= limit) {
    return stringValue;
  }
  return `${stringValue.slice(0, limit)}\n...truncated...`;
}

function toolSignature(toolName, args) {
  return `${toolName}:${JSON.stringify(args ?? {})}`;
}

function resolveWorkspacePath(workspaceRoot, filePath = ".") {
  const absolutePath = resolve(workspaceRoot, filePath);
  const relativePath = relative(workspaceRoot, absolutePath);
  if (relativePath.startsWith("..") || resolve(workspaceRoot, relativePath) !== absolutePath) {
    throw new Error(`Path escapes workspace: ${filePath}`);
  }
  return absolutePath;
}

function relPath(workspaceRoot, filePath) {
  return relative(workspaceRoot, filePath) || ".";
}

async function runRg(args, workspaceRoot) {
  const { stdout } = await execFileAsync("rg", args, {
    cwd: workspaceRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function workspaceSearchPaths(workspaceRoot, rawArgs = {}) {
  const query = String(rawArgs.query ?? "").trim();
  const limit = clamp(Number(rawArgs.limit ?? MAX_SEARCH_RESULTS), 1, 50);
  if (!query) {
    return { count: 0, results: [] };
  }

  const stdout = await runRg(["--files"], workspaceRoot);
  const results = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((filePath) => filePath.toLowerCase().includes(query.toLowerCase()))
    .slice(0, limit);
  return { count: results.length, results };
}

async function workspaceSearchCode(workspaceRoot, rawArgs = {}) {
  const query = String(rawArgs.query ?? "").trim();
  const limit = clamp(Number(rawArgs.limit ?? MAX_SEARCH_RESULTS), 1, 50);
  if (!query) {
    return { count: 0, results: [] };
  }

  const targetRoot = rawArgs.pathPrefix
    ? resolveWorkspacePath(workspaceRoot, String(rawArgs.pathPrefix))
    : workspaceRoot;
  const stdout = await runRg(
    ["-n", "--no-heading", "--smart-case", "--max-count", String(limit), query, targetRoot],
    workspaceRoot
  );
  const results = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) {
        return { filePath: line, lineNumber: null, line: "" };
      }
      const [, filePath, lineNumber, content] = match;
      return {
        filePath: relPath(workspaceRoot, resolve(workspaceRoot, filePath)),
        lineNumber: Number(lineNumber),
        line: content,
      };
    });
  return { count: results.length, results };
}

async function workspaceReadFile(workspaceRoot, rawArgs = {}) {
  const filePath = resolveWorkspacePath(workspaceRoot, String(rawArgs.filePath ?? ""));
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  const startLine = clamp(Number(rawArgs.startLine ?? 1), 1, Math.max(lines.length, 1));
  const endLine = clamp(
    Number(rawArgs.endLine ?? (startLine + MAX_FILE_LINES - 1)),
    startLine,
    Math.max(lines.length, startLine)
  );
  const excerpt = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
  return {
    filePath: relPath(workspaceRoot, filePath),
    startLine,
    endLine,
    content: excerpt,
  };
}

async function workspaceListDir(workspaceRoot, rawArgs = {}) {
  const dirPath = resolveWorkspacePath(workspaceRoot, String(rawArgs.path ?? "."));
  const entries = await readdir(dirPath, { withFileTypes: true });
  return {
    path: relPath(workspaceRoot, dirPath),
    entries: entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function toolSchema(name, description, parameters) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
    },
  };
}

function scoutToolDefinitions() {
  return [
    toolSchema("workspace_search_paths", "Find file paths in the workspace by substring match.", {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    }),
    toolSchema("workspace_search_code", "Search file contents in the workspace with ripgrep.", {
      type: "object",
      properties: {
        query: { type: "string" },
        pathPrefix: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    }),
    toolSchema("workspace_read_file", "Read a file from the workspace with optional line bounds.", {
      type: "object",
      properties: {
        filePath: { type: "string" },
        startLine: { type: "integer" },
        endLine: { type: "integer" },
      },
      required: ["filePath"],
    }),
    toolSchema("workspace_list_dir", "List files and directories under a workspace path.", {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    }),
    toolSchema("fc_search_paths", "FreeContext path discovery.", {
      type: "object",
      properties: {
        query: { type: "string" },
        pathPrefix: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    }),
    toolSchema("fc_search_code", "FreeContext code search with optional mode.", {
      type: "object",
      properties: {
        query: { type: "string" },
        pathPrefix: { type: "string" },
        limit: { type: "integer" },
        mode: { type: "string", enum: ["fulltext", "semantic", "hybrid"] },
      },
      required: ["query"],
    }),
    toolSchema("fc_find_symbol", "FreeContext symbol lookup by exact name.", {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    }),
    toolSchema("fc_get_symbol", "FreeContext symbol lookup by symbol id.", {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    }),
    toolSchema("fc_who_calls", "FreeContext caller lookup for a symbol.", {
      type: "object",
      properties: {
        symbolName: { type: "string" },
      },
      required: ["symbolName"],
    }),
    toolSchema("fc_what_does_this_call", "FreeContext callee lookup for a symbol.", {
      type: "object",
      properties: {
        symbolName: { type: "string" },
      },
      required: ["symbolName"],
    }),
    toolSchema("fc_list_file_symbols", "List symbols for a file through FreeContext.", {
      type: "object",
      properties: {
        filePath: { type: "string" },
      },
      required: ["filePath"],
    }),
    toolSchema("fc_codebase_map", "Get a high-level FreeContext codebase map.", {
      type: "object",
      properties: {},
    }),
  ];
}

async function runFreeContextTool(client, toolName, args) {
  const result = await client.callTool({
    name: toolName,
    arguments: args && typeof args === "object" ? args : {},
  });

  if (!result.structuredContent) {
    throw new Error(`FreeContext tool ${toolName} returned no structuredContent`);
  }

  return result.structuredContent;
}

function resultCount(result) {
  if (typeof result?.count === "number") {
    return result.count;
  }
  if (Array.isArray(result?.results)) {
    return result.results.length;
  }
  if (result?.symbol) {
    return 1;
  }
  return undefined;
}

function resultPreview(result) {
  return trimOutput(JSON.stringify(result));
}

async function traceScoutToolCall(traceSpan, toolName, args, result) {
  const isFreeContext = toolName.startsWith("fc_");
  const normalizedToolName = isFreeContext ? toolName.replace(/^fc_/, "") : toolName;

  await withChildSpan(
    traceSpan,
    {
      name: isFreeContext ? "freecontext_mcp_call" : "tool_call",
      input: { args },
      metadata: {
        phase: "scout",
        toolFamily: isFreeContext ? "freecontext" : "local",
        toolName: normalizedToolName,
        searchMode: args?.mode,
      },
    },
    async (toolSpan) => {
      toolSpan?.log?.({
        metadata: {
          resultCount: resultCount(result),
          semantic: args?.mode === "semantic" || args?.mode === "hybrid",
          resultPreview: resultPreview(result),
        },
      });
    }
  );
}

async function runScoutTool(call, workspaceRoot, client, toolName, args) {
  switch (toolName) {
    case "workspace_search_paths":
      return workspaceSearchPaths(workspaceRoot, args);
    case "workspace_search_code":
      return workspaceSearchCode(workspaceRoot, args);
    case "workspace_read_file":
      return workspaceReadFile(workspaceRoot, args);
    case "workspace_list_dir":
      return workspaceListDir(workspaceRoot, args);
    case "fc_search_paths":
      return runFreeContextTool(client, "search_paths", args);
    case "fc_search_code":
      return runFreeContextTool(client, "search_code", args);
    case "fc_find_symbol":
      return runFreeContextTool(client, "find_symbol", args);
    case "fc_get_symbol":
      return runFreeContextTool(client, "get_symbol", args);
    case "fc_who_calls":
      return runFreeContextTool(client, "who_calls", args);
    case "fc_what_does_this_call":
      return runFreeContextTool(client, "what_does_this_call", args);
    case "fc_list_file_symbols":
      return runFreeContextTool(client, "list_file_symbols", args);
    case "fc_codebase_map":
      return runFreeContextTool(client, "codebase_map", args);
    default:
      throw new Error(`Unknown scout tool: ${toolName}`);
  }
}

export async function callScoutModel(prompt, options = {}) {
  const runtime = resolveScoutRuntime(options);
  const model = runtime.model;
  const workspaceRoot = options.workspaceRoot;
  const useMcp = options.useMcp ?? true;
  const endpoint = useMcp ? resolveEvalEndpoint(options.endpoint) : undefined;
  const baseUrl = runtime.baseUrl;
  const apiKey = runtime.apiKey ?? (runtime.apiKeyEnv ? requireEnv(runtime.apiKeyEnv) : undefined);
  const startedAt = Date.now();
  const client = useMcp ? new Client({ name: "promptfoo-qwen-scout", version: "1.0.0" }) : null;
  if (client && endpoint) {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  }

  const localToolsUsed = [];
  const mcpToolsUsed = [];
  let localToolCount = 0;
  let mcpToolCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const seenToolCalls = new Map();
  const retrievalMode =
    options.retrievalMode === "embedding" || options.retrievalMode === "hybrid"
      ? options.retrievalMode
      : options.semantic
        ? "embedding"
        : "fulltext";

  const systemPrompt = [
    "You are a scout agent for code-intelligence evaluation.",
    "You are discovery-only and read-only.",
    useMcp
      ? "Use FreeContext MCP first for symbol lookup, path discovery, code search, and call graph queries."
      : "FreeContext MCP is not available in this tier. Use local workspace discovery tools only.",
    retrievalMode === "embedding"
      ? "For concept lookups with FreeContext search_code, prefer mode semantic first."
      : retrievalMode === "hybrid"
        ? "For concept lookups with FreeContext search_code, prefer mode hybrid first."
        : "Use exact text and graph evidence when it is sufficient.",
    "Use local workspace read/search tools only to verify and trim evidence.",
    "Never propose edits. Never produce a final patch.",
    "Return a compact evidence packet with exact file paths, exact symbol names, exact caller or callee facts, and unresolved ambiguities.",
  ].join(" ");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  try {
    for (let turn = 0; turn < (options.maxTurns ?? MAX_TOOL_TURNS); turn += 1) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages,
          tools: useMcp
            ? scoutToolDefinitions()
            : scoutToolDefinitions().filter((tool) => !tool.function.name.startsWith("fc_")),
          tool_choice: "auto",
        }),
      });

      if (!response.ok) {
        throw new Error(`Qwen scout request failed: ${response.status} ${await response.text()}`);
      }

      const json = await response.json();
      const choice = json.choices?.[0];
      const message = choice?.message;
      promptTokens += json.usage?.prompt_tokens ?? 0;
      completionTokens += json.usage?.completion_tokens ?? 0;

      if (!message) {
        throw new Error("Qwen scout returned no message");
      }

      const assistantMessage = {
        role: "assistant",
        content: message.content ?? "",
        ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
      };
      messages.push(assistantMessage);

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        return buildProviderResult({
          output: trimOutput(message.content ?? ""),
          model,
          usage: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          },
          metadata: {
            provider: "model-scout",
            tier: options.tier ?? "scout-research",
            retrievalMode: retrievalMode === "fulltext" ? "fulltext/graph" : retrievalMode,
            workspaceRoot,
            endpoint,
            durationMs: Date.now() - startedAt,
            model,
            scoutTurns: turn + 1,
            totalToolCount: localToolCount + mcpToolCount,
            localToolCount,
            mcpToolCount,
            localToolsUsed: uniq(localToolsUsed),
            mcpToolsUsed: uniq(mcpToolsUsed),
            traceFreeContextArgs: true,
          },
        });
      }

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;
        const rawArgs = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
        const signature = toolSignature(toolName, rawArgs);
        const seenCount = seenToolCalls.get(signature) ?? 0;
        seenToolCalls.set(signature, seenCount + 1);
        const result = seenCount >= 1
          ? {
              duplicate: true,
              message: "This exact tool call already ran. Reuse the prior evidence and move to the final scout summary.",
            }
          : await runScoutTool(toolCall, workspaceRoot, client, toolName, rawArgs);
        await traceScoutToolCall(options.traceSpan, toolName, rawArgs, result);
        if (toolName.startsWith("fc_")) {
          mcpToolCount += 1;
          mcpToolsUsed.push(toolName.replace(/^fc_/, ""));
        } else {
          localToolCount += 1;
          localToolsUsed.push(toolName);
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: trimOutput(JSON.stringify(result)),
        });
      }
    }
    const finalResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
          "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Stop using tools now. Return the compact scout evidence packet immediately with exact paths, exact symbols, and unresolved ambiguities only.",
          },
        ],
      }),
    });

    if (!finalResponse.ok) {
      throw new Error(`Qwen scout finalization failed: ${finalResponse.status} ${await finalResponse.text()}`);
    }

    const finalJson = await finalResponse.json();
    const finalMessage = finalJson.choices?.[0]?.message?.content ?? "";
    promptTokens += finalJson.usage?.prompt_tokens ?? 0;
    completionTokens += finalJson.usage?.completion_tokens ?? 0;

    return buildProviderResult({
      output: trimOutput(finalMessage),
      model,
      usage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      metadata: {
        provider: "model-scout",
        tier: options.tier ?? "scout-research",
        retrievalMode: retrievalMode === "fulltext" ? "fulltext/graph" : retrievalMode,
        workspaceRoot,
        endpoint,
        durationMs: Date.now() - startedAt,
        model,
        scoutTurns: options.maxTurns ?? MAX_TOOL_TURNS,
        totalToolCount: localToolCount + mcpToolCount,
        localToolCount,
        mcpToolCount,
        localToolsUsed: uniq(localToolsUsed),
        mcpToolsUsed: uniq(mcpToolsUsed),
        traceFreeContextArgs: true,
        forcedSummary: true,
      },
    });
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function callQwenScout(prompt, options = {}) {
  return callScoutModel(prompt, options);
}
