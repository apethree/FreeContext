import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function usageFor(result) {
  if (result.tokenUsage) {
    return result.tokenUsage;
  }
  return (
    result.response?.tokenUsage ??
    result.response?.metadata?.tokenUsage ??
    { prompt: 0, completion: 0, total: 0 }
  );
}

function metadataFor(result) {
  if (result.metadata) {
    return result.metadata;
  }
  return result.response?.metadata ?? {};
}

function firstLine(value) {
  return String(value ?? "").split("\n")[0];
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(",") : "-";
}

function formatValue(value) {
  return value ?? "-";
}

function effectiveInput(usage) {
  return (usage.prompt ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function hasScoutPhaseBreakdown(metadata) {
  return metadata.scoutPromptTokens !== undefined || metadata.scoutCostUsd !== undefined;
}

function hasMainPhaseBreakdown(metadata) {
  return metadata.mainPromptTokens !== undefined || metadata.mainCostUsd !== undefined;
}

function rowsFor(json) {
  if (Array.isArray(json.results?.results)) {
    return json.results.results;
  }
  if (Array.isArray(json.results)) {
    return json.results;
  }
  if (Array.isArray(json.rows)) {
    return json.rows;
  }
  if (Array.isArray(json.results?.rows)) {
    return json.results.rows;
  }
  return Array.isArray(json.results) ? json.results : [];
}

async function run() {
  const targetPath = resolve(process.cwd(), process.argv[2] ?? "evals/.promptfoo/results.json");
  const raw = await readFile(targetPath, "utf8");
  const json = JSON.parse(raw);
  const rowsOutput = rowsFor(json);

  if (!Array.isArray(rowsOutput) || rowsOutput.length === 0) {
    throw new Error(`No eval rows found in ${targetPath}`);
  }

  process.stdout.write(`Report: ${targetPath}\n`);
  if (json.results?.timestamp) {
    process.stdout.write(`Timestamp: ${json.results.timestamp}\n`);
  }
  if (json.summary) {
    process.stdout.write(`Experiment: ${json.summary.experimentName ?? "-"}\n`);
  }
  process.stdout.write(`Rows: ${rowsOutput.length}\n\n`);

  for (const row of rowsOutput) {
    const usage = usageFor(row);
    const metadata = metadataFor(row);
    const label =
      metadata.variantDisplayName ??
      row.provider?.label ??
      row.provider?.id ??
      metadata.providerLabel ??
      "unknown";
    const description = row.testCase?.description ?? row.description ?? metadata.caseDescription ?? row.input?.description ?? "unnamed";
    const scoreSummary = row.success !== undefined
      ? row.score ?? "-"
      : Object.entries(row.scores ?? {})
        .map(([name, value]) => `${name}=${value ?? "-"}`)
        .join(",");
    const summary = [
      `${label}`,
      row.success !== undefined ? (row.success ? "PASS" : "FAIL") : "BT",
      `score=${scoreSummary}`,
      `latencyMs=${row.latencyMs ?? metadata.totalDurationMs ?? metadata.durationMs ?? metadata.modelLatencyMs ?? "-"}`,
      `freshPromptTokens=${usage.prompt ?? 0}`,
      `completionTokens=${usage.completion ?? 0}`,
      `cacheReadTokens=${usage.cacheRead ?? 0}`,
      `cacheWriteTokens=${usage.cacheWrite ?? 0}`,
      `effectiveInputTokens=${effectiveInput(usage)}`,
      `totalTokens=${usage.total ?? 0}`,
      `cost=${formatValue(usage.cost ?? metadata.costUsd)}`,
      `mainLocalToolCount=${metadata.mainLocalToolCount ?? metadata.localToolCount ?? 0}`,
      `mainMcpToolCount=${metadata.mainMcpToolCount ?? metadata.mcpToolCount ?? 0}`,
      `scoutLocalToolCount=${metadata.scoutLocalToolCount ?? 0}`,
      `scoutMcpToolCount=${metadata.scoutMcpToolCount ?? 0}`,
      `toolCount=${metadata.totalToolCount ?? metadata.toolCount ?? 0}`,
    ].join("\t");

    process.stdout.write(`${summary}\n`);
    process.stdout.write(`  Test: ${description}\n`);
    process.stdout.write(`  Model: ${metadata.model ?? "-"}\n`);
    if (metadata.mainModel) {
      process.stdout.write(`  Main model: ${metadata.mainModel}\n`);
    }
    process.stdout.write(`  Tier: ${metadata.tier ?? "-"}\n`);
    if (metadata.strategyLabel ?? metadata.strategy) {
      process.stdout.write(`  Strategy: ${metadata.strategyLabel ?? metadata.strategy}\n`);
    }
    process.stdout.write(`  Retrieval: ${metadata.retrievalMode ?? "-"}\n`);
    if (metadata.scoredArtifact) {
      process.stdout.write(`  Scored artifact: ${metadata.scoredArtifact}\n`);
    }
    process.stdout.write(`  Fresh prompt tokens: ${usage.prompt ?? 0}\n`);
    process.stdout.write(`  Cache read tokens: ${usage.cacheRead ?? 0}\n`);
    process.stdout.write(`  Cache write tokens: ${usage.cacheWrite ?? 0}\n`);
    process.stdout.write(`  Effective input surface: ${effectiveInput(usage)}\n`);
    process.stdout.write(`  Workspace: ${metadata.workspaceRoot ?? "-"}\n`);
    if (metadata.endpoint) {
      process.stdout.write(`  Endpoint: ${metadata.endpoint}\n`);
    }
    process.stdout.write(`  Main local tools: ${formatList(metadata.mainLocalToolsUsed ?? metadata.localToolsUsed)}\n`);
    process.stdout.write(`  Main MCP tools: ${formatList(metadata.mainMcpToolsUsed ?? metadata.mcpToolsUsed)}\n`);
    if (hasMainPhaseBreakdown(metadata)) {
      process.stdout.write(`  Main prompt tokens: ${metadata.mainPromptTokens ?? 0}\n`);
      process.stdout.write(`  Main completion tokens: ${metadata.mainCompletionTokens ?? 0}\n`);
      process.stdout.write(`  Main cache read tokens: ${metadata.mainCacheReadTokens ?? 0}\n`);
      process.stdout.write(`  Main cache write tokens: ${metadata.mainCacheWriteTokens ?? 0}\n`);
      process.stdout.write(`  Main effective input: ${metadata.mainEffectiveInputTokens ?? 0}\n`);
      process.stdout.write(`  Main total tokens: ${metadata.mainTotalTokens ?? 0}\n`);
      process.stdout.write(`  Main cost: ${formatValue(metadata.mainCostUsd)}\n`);
    }
    if (metadata.mainToolsUsed) {
      process.stdout.write(`  Main tools: ${formatList(metadata.mainToolsUsed)}\n`);
    }
    if (hasScoutPhaseBreakdown(metadata)) {
      process.stdout.write(`  Scout model: ${metadata.scoutModel ?? "-"}\n`);
      process.stdout.write(`  Scout prompt tokens: ${metadata.scoutPromptTokens ?? 0}\n`);
      process.stdout.write(`  Scout completion tokens: ${metadata.scoutCompletionTokens ?? 0}\n`);
      process.stdout.write(`  Scout cache read tokens: ${metadata.scoutCacheReadTokens ?? 0}\n`);
      process.stdout.write(`  Scout cache write tokens: ${metadata.scoutCacheWriteTokens ?? 0}\n`);
      process.stdout.write(`  Scout effective input: ${metadata.scoutEffectiveInputTokens ?? 0}\n`);
      process.stdout.write(`  Scout total tokens: ${metadata.scoutTotalTokens ?? 0}\n`);
      process.stdout.write(`  Scout cost: ${formatValue(metadata.scoutCostUsd)}\n`);
    }
    if (metadata.scoutMcpToolsUsed) {
      process.stdout.write(`  Scout MCP tools: ${formatList(metadata.scoutMcpToolsUsed)}\n`);
    }
    if (metadata.scoutLocalToolsUsed) {
      process.stdout.write(`  Scout local tools: ${formatList(metadata.scoutLocalToolsUsed)}\n`);
    }
    if (metadata.scoutToolsUsed) {
      process.stdout.write(`  Scout tools: ${formatList(metadata.scoutToolsUsed)}\n`);
    }
    if (metadata.changedPaths) {
      process.stdout.write(`  Changed paths: ${formatList(metadata.changedPaths)}\n`);
    }
    if (metadata.numTurns !== undefined) {
      process.stdout.write(`  Agent turns: ${metadata.numTurns}\n`);
    }
    if (metadata.simulatedToolMarkup !== undefined) {
      process.stdout.write(`  SimulatedToolMarkup: ${metadata.simulatedToolMarkup}\n`);
    }
    const reason = row.error || row.gradingResult?.reason;
    if (reason) {
      process.stdout.write(`  Reason: ${firstLine(reason)}\n`);
    }
    if (row.scores) {
      process.stdout.write(`  Scores: ${Object.entries(row.scores).map(([name, value]) => `${name}=${value ?? "-"}`).join(", ")}\n`);
    }
    process.stdout.write("\n");
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
