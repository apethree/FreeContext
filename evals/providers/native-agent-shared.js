import { Codex } from "@openai/codex-sdk";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  buildProviderResult,
  estimateCost,
  requireEnv,
  resolveEvalEndpoint,
} from "./agent-shared.js";
import { withChildSpan } from "./braintrust-shared.js";

const FREE_CONTEXT_MCP_TOOLS = new Set([
  "search_code",
  "search_paths",
  "find_symbol",
  "get_symbol",
  "who_calls",
  "what_does_this_call",
  "list_file_symbols",
  "recently_changed_symbols",
  "reindex",
  "codebase_map",
]);

const DEFAULT_CODEX_MODEL = process.env.OPENAI_AGENT_EVAL_MODEL ?? "gpt-5-codex-mini";
const DEFAULT_CLAUDE_MODEL = process.env.ANTHROPIC_AGENT_EVAL_MODEL ?? "claude-haiku-4-5-20251001";
const DEFAULT_CODEX_BASE_URL = process.env.OPENAI_BASE_URL;

function normalizeRetrievalMode(options = {}) {
  if (options.retrievalMode === "embedding" || options.retrievalMode === "hybrid") {
    return options.retrievalMode;
  }
  return options.semantic ? "embedding" : "fulltext";
}

function retrievalTraceLabel(options = {}) {
  const retrievalMode = normalizeRetrievalMode(options);
  if (retrievalMode === "embedding") return "embedding";
  if (retrievalMode === "hybrid") return "hybrid";
  return "fulltext/graph";
}

function withToolInstructions(prompt, { useMcp = false, semantic = false, retrievalMode } = {}) {
  const lines = [
    "You are evaluating coding-agent capability on an isolated sandbox workspace.",
    "Use the available coding tools to inspect the workspace directly before answering.",
    "Name exact file paths and exact method or function names.",
    "Do not claim to have searched or read files unless you actually used tools.",
  ];

  if (useMcp) {
    lines.push("FreeContext MCP is available. Use it for symbol lookup, path search, and call graph queries.");
    const resolvedMode = retrievalMode ?? (semantic ? "embedding" : "fulltext");
    if (resolvedMode === "embedding") {
      lines.push("When you use FreeContext search_code for concept lookups, prefer mode semantic first. Use hybrid only if needed.");
    } else if (resolvedMode === "hybrid") {
      lines.push("When you use FreeContext search_code for concept lookups, prefer mode hybrid first.");
    }
  }

  return `${lines.join(" ")}\n\n${prompt}`;
}

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function commandName(command = "") {
  return String(command).trim().split(/\s+/)[0] ?? "";
}

function isClaudeMcpTool(toolName = "") {
  if (toolName.startsWith("mcp__free_context__")) {
    return true;
  }

  const normalized = toolName.replace(/^mcp__free_context__/, "");
  return FREE_CONTEXT_MCP_TOOLS.has(normalized);
}

function toolTier(useMcp, scout = false) {
  if (scout) return "scout";
  return useMcp ? "freecontext" : "base";
}

function codexCliConfig(useMcp, endpoint) {
  if (!useMcp) {
    return {};
  }

  return {
    mcp_servers: {
      free_context: {
        url: resolveEvalEndpoint(endpoint),
      },
    },
  };
}

function buildClaudeMcpServers(useMcp, endpoint) {
  if (!useMcp) {
    return undefined;
  }

  return {
    free_context: {
      type: "http",
      url: resolveEvalEndpoint(endpoint),
    },
  };
}

function summarizeCodexItems(items) {
  const allMcpItems = items.filter((item) => item.type === "mcp_tool_call" && item.status === "completed");
  const mcpItems = allMcpItems.filter(
    (item) => item.server === "free_context" || FREE_CONTEXT_MCP_TOOLS.has(item.tool)
  );
  const commandItems = items.filter((item) => item.type === "command_execution" && item.status === "completed");
  const fileChangeItems = items.filter((item) => item.type === "file_change" && item.status === "completed");
  const webSearchItems = items.filter((item) => item.type === "web_search");

  return {
    totalToolCount: mcpItems.length + commandItems.length + fileChangeItems.length + webSearchItems.length,
    localToolCount: commandItems.length + fileChangeItems.length,
    mcpToolCount: mcpItems.length,
    webSearchCount: webSearchItems.length,
    localToolsUsed: uniq(commandItems.map((item) => commandName(item.command))),
    mcpToolsUsed: uniq(mcpItems.map((item) => `${item.server}/${item.tool}`)),
    fileChangeCount: fileChangeItems.reduce((sum, item) => sum + item.changes.length, 0),
    changedPaths: uniq(fileChangeItems.flatMap((item) => item.changes.map((change) => change.path))),
  };
}

function extractCodexToolCalls(items) {
  return items.flatMap((item) => {
    if (item.type === "mcp_tool_call" && item.status === "completed") {
      const toolName = `${item.server}/${item.tool}`;
      const args = item.arguments ?? item.input ?? item.params ?? undefined;
      return [{
        family: item.server === "free_context" || FREE_CONTEXT_MCP_TOOLS.has(item.tool) ? "freecontext" : "mcp",
        name: toolName,
        args,
      }];
    }

    if (item.type === "command_execution" && item.status === "completed") {
      return [{
        family: "local",
        name: commandName(item.command),
        args: { command: item.command },
      }];
    }

    if (item.type === "file_change" && item.status === "completed") {
      return [{
        family: "local",
        name: "file_change",
        args: { changes: item.changes?.map((change) => change.path) ?? [] },
      }];
    }

    return [];
  });
}

function summarizeClaudeMessages(messages) {
  const toolMessages = messages.filter((message) => message.type === "tool_progress");
  const taskProgress = messages.filter(
    (message) => message.type === "system" && message.subtype === "task_progress"
  );
  const resultMessage = messages.find((message) => message.type === "result");
  const streamedToolNames = toolMessages
    .map((message) => message.tool_name)
    .filter(Boolean);
  const assistantToolUses = messages.flatMap((message) => {
    if (message.type !== "assistant" || !Array.isArray(message.message?.content)) {
      return [];
    }

    return message.message.content
      .filter((content) => content?.type === "tool_use" && typeof content?.name === "string")
      .map((content) => content.name);
  });
  const toolInvocations = [...streamedToolNames, ...assistantToolUses];
  const uniqueToolNames = uniq(toolInvocations);
  const mcpToolsUsed = uniqueToolNames.filter((toolName) => isClaudeMcpTool(toolName));
  const localToolsUsed = uniqueToolNames.filter((toolName) => !isClaudeMcpTool(toolName));
  const mcpToolCount = toolInvocations.filter((toolName) => isClaudeMcpTool(toolName)).length;
  const localToolCount = toolInvocations.filter((toolName) => !isClaudeMcpTool(toolName)).length;

  return {
    totalToolCount: toolInvocations.length,
    localToolCount,
    mcpToolCount,
    localToolsUsed,
    mcpToolsUsed,
    toolProgressCount: toolInvocations.length,
    taskCount: taskProgress.length,
    resultMessage,
  };
}

function extractClaudeToolCalls(messages) {
  const toolResultsById = new Map(
    messages.flatMap((message) => {
      if (message.type !== "user" || !Array.isArray(message.message?.content)) {
        return [];
      }

      return message.message.content
        .filter((content) => content?.type === "tool_result" && typeof content?.tool_use_id === "string")
        .map((content) => [content.tool_use_id, content.content]);
    })
  );

  return messages.flatMap((message) => {
    if (message.type !== "assistant" || !Array.isArray(message.message?.content)) {
      return [];
    }

    return message.message.content
      .filter((content) => content?.type === "tool_use" && typeof content?.name === "string")
      .map((content) => ({
        family: isClaudeMcpTool(content.name) ? "freecontext" : "local",
        name: content.name,
        args: content.input,
        resultPreview:
          typeof content.id === "string" ? String(toolResultsById.get(content.id) ?? "").slice(0, 4000) : undefined,
      }));
  });
}

async function emitToolCallSpans(parentSpan, phase, calls = []) {
  for (const call of calls) {
    const spanName = call.family === "freecontext" ? "freecontext_mcp_call" : "tool_call";
    await withChildSpan(parentSpan, {
      name: spanName,
      input: call.args ? { args: call.args } : undefined,
      metadata: {
        phase,
        toolFamily: call.family,
        toolName: call.name,
        searchMode: call.args?.mode,
      },
    }, async (toolSpan) => {
      if (call.resultPreview) {
        toolSpan?.log?.({
          metadata: {
            resultPreview: call.resultPreview,
          },
        });
      }
    });
  }
}

function runPhaseSpan(options, metadata, fn) {
  if (options.useExistingSpan) {
    return fn(options.traceSpan ?? null);
  }

  return withChildSpan(
    options.traceSpan,
    {
      name: options.phaseName ?? "main_phase",
      input: { prompt: options.promptForTrace },
      metadata,
    },
    fn
  );
}

export async function callCodexAgent(prompt, options = {}) {
  const model = options.model ?? DEFAULT_CODEX_MODEL;
  const workspaceRoot = options.workspaceRoot;
  const useMcp = options.useMcp ?? false;
  const endpoint = resolveEvalEndpoint(options.endpoint);
  const startedAt = Date.now();
  const codex = new Codex({
    apiKey: requireEnv("OPENAI_API_KEY"),
    ...((options.baseUrl ?? DEFAULT_CODEX_BASE_URL) ? { baseUrl: options.baseUrl ?? DEFAULT_CODEX_BASE_URL } : {}),
    config: codexCliConfig(useMcp, endpoint),
  });

  return runPhaseSpan({ ...options, promptForTrace: prompt }, {
      provider: "codex-sdk",
      tier: options.tier ?? toolTier(useMcp),
      retrievalMode: retrievalTraceLabel(options),
    }, async (phaseSpan) => {
    try {
      const thread = codex.startThread({
        model,
        workingDirectory: workspaceRoot,
        skipGitRepoCheck: true,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        webSearchEnabled: false,
        additionalDirectories: [workspaceRoot],
        ...(options.reasoningEffort ? { modelReasoningEffort: options.reasoningEffort } : {}),
      });
      const result = await thread.run(withToolInstructions(prompt, options));
      const telemetry = summarizeCodexItems(result.items);
      await emitToolCallSpans(phaseSpan, "main", extractCodexToolCalls(result.items));

      const providerResult = buildProviderResult({
        output: result.finalResponse,
        model,
        usage: {
          prompt: result.usage?.input_tokens ?? 0,
          completion: result.usage?.output_tokens ?? 0,
          total: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
          cacheRead: result.usage?.cached_input_tokens ?? 0,
        },
        metadata: {
          provider: "codex-sdk",
          tier: options.tier ?? toolTier(useMcp),
          retrievalMode: retrievalTraceLabel(options),
          workspaceRoot,
          endpoint: useMcp ? endpoint : undefined,
          durationMs: Date.now() - startedAt,
          ...telemetry,
          items: result.items,
        },
      });

      return providerResult;
    } finally {
      // Codex SDK does not currently expose a close on the thread; client is process-scoped.
    }
  });
}

export async function callClaudeAgent(prompt, options = {}) {
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  const workspaceRoot = options.workspaceRoot;
  const useMcp = options.useMcp ?? false;
  const endpoint = resolveEvalEndpoint(options.endpoint);
  const startedAt = Date.now();
  return runPhaseSpan({ ...options, promptForTrace: prompt }, {
      provider: "claude-agent-sdk",
      tier: options.tier ?? toolTier(useMcp),
      retrievalMode: retrievalTraceLabel(options),
    }, async (phaseSpan) => {
    const stream = claudeQuery({
      prompt: withToolInstructions(prompt, options),
      options: {
        model,
        cwd: workspaceRoot,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: options.maxTurns ?? 12,
        additionalDirectories: [workspaceRoot],
        mcpServers: buildClaudeMcpServers(useMcp, endpoint),
        disallowedTools: ["WebSearch", "WebFetch"],
      },
    });

    const messages = [];
    let resultMessage = null;
    try {
      for await (const message of stream) {
        messages.push(message);
        if (message.type === "result") {
          resultMessage = message;
        }
      }
    } finally {
      stream.close();
    }

    if (!resultMessage) {
      throw new Error("Claude Agent SDK returned no final result message");
    }

    const telemetry = summarizeClaudeMessages(messages);
    await emitToolCallSpans(phaseSpan, "main", extractClaudeToolCalls(messages));

    const providerResult = buildProviderResult({
      output: resultMessage.subtype === "success" ? resultMessage.result : resultMessage.errors?.join("\n") ?? "",
      model,
      usage: {
        prompt: resultMessage.usage?.input_tokens ?? 0,
        completion: resultMessage.usage?.output_tokens ?? 0,
        total: resultMessage.usage?.total_tokens ?? ((resultMessage.usage?.input_tokens ?? 0) + (resultMessage.usage?.output_tokens ?? 0)),
        cacheRead: resultMessage.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: resultMessage.usage?.cache_creation_input_tokens ?? 0,
        actualCostUsd: typeof resultMessage.total_cost_usd === "number" ? resultMessage.total_cost_usd : undefined,
      },
      metadata: {
        provider: "claude-agent-sdk",
        tier: options.tier ?? toolTier(useMcp),
        retrievalMode: retrievalTraceLabel(options),
        workspaceRoot,
        endpoint: useMcp ? endpoint : undefined,
        durationMs: Date.now() - startedAt,
        stopReason: resultMessage.stop_reason,
        numTurns: resultMessage.num_turns,
        permissionDenials: resultMessage.permission_denials?.length ?? 0,
        ...telemetry,
        messages,
      },
    });

    return providerResult;
  });
}

export async function callScoutWithAgent(prompt, options = {}) {
  const scoutUseMcp = options.useMcp ?? true;
  const scoutPhase = await withChildSpan(options.traceSpan, {
    name: "scout_phase",
    input: { prompt },
    metadata: {
      tier: options.tier ?? (scoutUseMcp ? "scout" : "scout-base"),
      scoutModel: options.scoutModel,
      retrievalMode: retrievalTraceLabel(options),
      useMcp: scoutUseMcp,
    },
  }, async (scoutSpan) => options.scoutCall(
    withToolInstructions(prompt, {
      useMcp: scoutUseMcp,
      semantic: options.semantic ?? false,
      retrievalMode: normalizeRetrievalMode(options),
    }),
    scoutSpan
  ));

  const synthesisPrompt =
    "A scout agent researched the codebase and found the following evidence.\n\n" +
    "--- SCOUT FINDINGS ---\n" +
    `${scoutPhase.output ?? ""}\n` +
    "--- END SCOUT FINDINGS ---\n\n" +
    "Now solve the task yourself using your own coding tools as needed. " +
    "Treat the scout findings as hints, not ground truth. Verify important claims before answering.\n\n" +
    prompt;

  const mainResult = await withChildSpan(options.traceSpan, {
    name: "main_phase",
    input: { prompt: synthesisPrompt },
    metadata: {
      tier: options.tier ?? (scoutUseMcp ? "scout" : "scout-base"),
      scoutModel: options.scoutModel,
      retrievalMode: retrievalTraceLabel(options),
    },
  }, async (mainSpan) => options.mainCall(synthesisPrompt, mainSpan));
  const scoutUsage = scoutPhase.tokenUsage ?? {};
  const mainUsage = mainResult.tokenUsage ?? {};
  const mainMetadata = mainResult.metadata ?? {};
  const scoutMetadata = scoutPhase.metadata ?? {};
  const scoutModel = options.scoutModel ?? scoutMetadata.model ?? "scout";
  const model = `${scoutModel}+${mainMetadata.model ?? "agent"}`;
  const scoutCost =
    typeof scoutUsage.cost === "number"
      ? scoutUsage.cost
      : estimateCost(scoutModel, scoutUsage.prompt ?? 0, scoutUsage.completion ?? 0);
  const mainCost = typeof mainUsage.cost === "number" ? mainUsage.cost : null;
  const aggregatedResult = buildProviderResult({
    output: mainResult.output,
    model,
    usage: {
      prompt: (scoutUsage.prompt ?? 0) + (mainUsage.prompt ?? 0),
      completion: (scoutUsage.completion ?? 0) + (mainUsage.completion ?? 0),
      total: (scoutUsage.total ?? 0) + (mainUsage.total ?? 0),
      cacheRead: (scoutUsage.cacheRead ?? 0) + (mainUsage.cacheRead ?? 0),
      cacheWrite: (scoutUsage.cacheWrite ?? 0) + (mainUsage.cacheWrite ?? 0),
      actualCostUsd:
        scoutCost != null || mainCost != null
          ? (scoutCost ?? 0) + (mainCost ?? 0)
          : undefined,
    },
    metadata: {
      ...mainMetadata,
      tier: options.tier ?? (scoutUseMcp ? "scout" : "scout-base"),
      retrievalMode: retrievalTraceLabel(options),
      scoutModel,
      mainModel: mainMetadata.model,
      mainToolCount: mainMetadata.totalToolCount ?? 0,
      mainLocalToolCount: mainMetadata.localToolCount ?? 0,
      mainMcpToolCount: mainMetadata.mcpToolCount ?? 0,
      mainLocalToolsUsed: mainMetadata.localToolsUsed ?? [],
      mainMcpToolsUsed: mainMetadata.mcpToolsUsed ?? [],
      mainToolsUsed: uniq([
        ...(mainMetadata.localToolsUsed ?? []),
        ...(mainMetadata.mcpToolsUsed ?? []),
      ]),
      mainPromptTokens: mainUsage.prompt ?? 0,
      mainCompletionTokens: mainUsage.completion ?? 0,
      mainTotalTokens: mainUsage.total ?? 0,
      mainCacheReadTokens: mainUsage.cacheRead ?? 0,
      mainCacheWriteTokens: mainUsage.cacheWrite ?? 0,
      mainEffectiveInputTokens:
        (mainUsage.prompt ?? 0) + (mainUsage.cacheRead ?? 0) + (mainUsage.cacheWrite ?? 0),
      ...(mainCost != null ? { mainCostUsd: mainCost } : {}),
      scoutToolCount: scoutMetadata.totalToolCount ?? 0,
      scoutLocalToolCount: scoutMetadata.localToolCount ?? 0,
      scoutMcpToolCount: scoutMetadata.mcpToolCount ?? 0,
      scoutLocalToolsUsed: scoutMetadata.localToolsUsed ?? [],
      scoutMcpToolsUsed: scoutMetadata.mcpToolsUsed ?? [],
      scoutToolsUsed: uniq([
        ...(scoutMetadata.localToolsUsed ?? []),
        ...(scoutMetadata.mcpToolsUsed ?? []),
      ]),
      scoutPromptTokens: scoutUsage.prompt ?? 0,
      scoutCompletionTokens: scoutUsage.completion ?? 0,
      scoutTotalTokens: scoutUsage.total ?? 0,
      scoutCacheReadTokens: scoutUsage.cacheRead ?? 0,
      scoutCacheWriteTokens: scoutUsage.cacheWrite ?? 0,
      scoutEffectiveInputTokens:
        (scoutUsage.prompt ?? 0) + (scoutUsage.cacheRead ?? 0) + (scoutUsage.cacheWrite ?? 0),
      ...(scoutCost != null ? { scoutCostUsd: scoutCost } : {}),
      scoutDurationMs: scoutMetadata.durationMs ?? 0,
      totalDurationMs: (scoutMetadata.durationMs ?? 0) + (mainMetadata.durationMs ?? 0),
    },
  });

  return aggregatedResult;
}
