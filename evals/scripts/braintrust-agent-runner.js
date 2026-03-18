import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Eval } from "braintrust";
import { loadLocalEnv } from "./load-local-env.js";
import { prepareAgentWorkspace } from "./prepare-workspace.js";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";
import { listActiveAgentVariants } from "./agent-variant-matrix.js";
import { loadBraintrustCases } from "./braintrust-case-loader.js";
import { llmJudgeScorer, strictDeterministicScorer } from "./braintrust-scorers.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const BRAINTRUST_OUTPUT_DIR = resolve(REPO_ROOT, "evals", ".braintrust");

loadLocalEnv();

function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function safeData(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function effectiveInputTokens(usage = {}) {
  return (usage.prompt ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function filterVariants(variants, targetFilter) {
  if (!targetFilter) {
    return variants;
  }
  const regex = new RegExp(targetFilter);
  return variants.filter((variant) => regex.test(variant.label));
}

function shorten(value, max = 72) {
  const text = String(value ?? "").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function retrievalLabel(retrievalMode = "fulltext") {
  if (retrievalMode === "embedding") return "Embedding";
  if (retrievalMode === "hybrid") return "Hybrid";
  return "Fulltext";
}

function experimentName({ retrievalMode, group, variants, cases }) {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const parts = [`Agent ${retrievalLabel(retrievalMode)} Eval`];

  if (group === "all") {
    parts.push("All providers");
  } else {
    parts.push(group === "anthropic" ? "Anthropic" : group === "openai" ? "OpenAI" : group);
  }

  if (variants.length === 1) {
    const variant = variants[0];
    parts.push(variant.strategyLabel ?? variant.strategy);
    parts.push(variant.mainModel ?? variant.providerFamily);
    if (variant.scoutModel) {
      parts.push(`Scout ${variant.scoutModel}`);
    }
  } else {
    parts.push(`${variants.length} variants`);
  }

  if (cases.length === 1) {
    parts.push(shorten(cases[0].metadata.caseDescription ?? cases[0].id, 56));
  } else {
    parts.push(`${cases.length} cases`);
  }

  parts.push(timestamp);
  return parts.join(" | ");
}

function storageOptions(retrievalMode, workspaceRoot) {
  if (retrievalMode === "fulltext") {
    return {
      port: Number(process.env.FREE_CONTEXT_BRAINTRUST_AGENT_MCP_PORT ?? "3224"),
      workspaceRoot,
      storageDirName: "braintrust-agent-db",
    };
  }

  return {
    port:
      retrievalMode === "hybrid"
        ? Number(process.env.FREE_CONTEXT_BRAINTRUST_HYBRID_AGENT_MCP_PORT ?? "3226")
        : Number(process.env.FREE_CONTEXT_BRAINTRUST_EMBEDDING_AGENT_MCP_PORT ?? "3225"),
    storageDirName: retrievalMode === "hybrid" ? "braintrust-hybrid-agent-db" : "braintrust-embedding-agent-db",
    storagePath: resolve(
      REPO_ROOT,
      "evals",
      ".promptfoo",
      retrievalMode === "hybrid" ? "braintrust-hybrid-agent-db" : "braintrust-embedding-agent-db"
    ),
    workspaceRoot,
    embed: true,
    healthTimeoutMs: 15 * 60_000,
  };
}

async function writeSummaryFile(kind, result) {
  await mkdir(BRAINTRUST_OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(
    BRAINTRUST_OUTPUT_DIR,
    `${kind}-${Date.now()}.json`
  );
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return outputPath;
}

function buildRowMetadata(baseMetadata, variant, providerResult, workspaceRoot, endpoint, retrievalMode) {
  const tokenUsage = providerResult.tokenUsage ?? {};
  const providerMetadata = providerResult.metadata ?? {};
  const costUsd = tokenUsage.cost ?? providerMetadata.costUsd ?? null;

  return {
    ...baseMetadata,
    ...safeData(providerMetadata),
    providerLabel: variant?.label ?? baseMetadata.providerLabel,
    providerFamily: variant?.providerFamily ?? baseMetadata.providerFamily,
    providerDisplayName: variant?.providerDisplayName ?? baseMetadata.providerDisplayName,
    strategy: variant?.strategy ?? baseMetadata.strategy,
    strategyLabel: variant?.strategyLabel ?? baseMetadata.strategyLabel,
    variantKey: variant?.variantKey ?? baseMetadata.variantKey,
    variantDisplayName: variant?.variantDisplayName ?? baseMetadata.variantDisplayName,
    semantic: retrievalMode !== "fulltext",
    scoutModel: variant?.scoutModel ?? providerMetadata.scoutModel ?? null,
    mainModel: variant?.mainModel ?? providerMetadata.mainModel ?? providerMetadata.model ?? null,
    retrievalLabel: retrievalLabel(retrievalMode),
    scoredArtifact: "final-answer",
    workspaceRoot,
    endpoint,
    tokenUsage: safeData(tokenUsage),
    promptTokens: tokenUsage.prompt ?? 0,
    completionTokens: tokenUsage.completion ?? 0,
    totalTokens: tokenUsage.total ?? 0,
    cacheReadTokens: tokenUsage.cacheRead ?? 0,
    cacheWriteTokens: tokenUsage.cacheWrite ?? 0,
    effectiveInputTokens: effectiveInputTokens(tokenUsage),
    ...(costUsd != null ? { costUsd } : {}),
    providerResponse: {
      output: providerResult.output,
      tokenUsage: safeData(tokenUsage),
      metadata: safeData(providerMetadata),
    },
  };
}

export async function runBraintrustAgentEval({
  configPath,
  semantic = false,
  retrievalMode,
  rawArgs = process.argv.slice(2),
} = {}) {
  if (!process.env.BRAINTRUST_API_KEY) {
    throw new Error("Set BRAINTRUST_API_KEY before running Braintrust-native evals.");
  }

  const resolvedRetrievalMode =
    retrievalMode === "embedding" || retrievalMode === "hybrid"
      ? retrievalMode
      : semantic
        ? "embedding"
        : "fulltext";
  const group = readArgValue(rawArgs, "--group") ?? "all";
  const targetFilter = readArgValue(rawArgs, "--filter-targets");
  const filterPattern = readArgValue(rawArgs, "--filter-pattern");
  const firstNRaw = readArgValue(rawArgs, "--filter-first-n");
  const firstN = firstNRaw ? Number(firstNRaw) : undefined;

  const variants = filterVariants(listActiveAgentVariants({ group, semantic: resolvedRetrievalMode !== "fulltext" }), targetFilter);
  if (variants.length === 0) {
    throw new Error(`No Braintrust variants matched for group "${group}"${targetFilter ? ` and filter "${targetFilter}"` : ""}.`);
  }

  const { suite, cases } = await loadBraintrustCases(configPath, {
    filterPattern,
    ...(Number.isFinite(firstN) ? { firstN } : {}),
  });
  if (cases.length === 0) {
    throw new Error(`No Braintrust cases matched for ${configPath}.`);
  }

  const data = cases.flatMap((testCase) =>
    variants.map((variant) => ({
      id: `${testCase.id}::${variant.label}`,
      input: {
        ...testCase.input,
        providerLabel: variant.label,
      },
      expected: testCase.expected,
      tags: [
        `suite:${testCase.metadata.suite}`,
        `provider:${variant.providerFamily}`,
        `strategy:${variant.strategy}`,
        `retrieval:${resolvedRetrievalMode}`,
      ],
      metadata: {
        ...testCase.metadata,
        providerLabel: variant.label,
        providerFamily: variant.providerFamily,
        providerDisplayName: variant.providerDisplayName,
        strategy: variant.strategy,
        strategyLabel: variant.strategyLabel,
        variantKey: variant.variantKey,
        variantDisplayName: variant.variantDisplayName,
        semantic: resolvedRetrievalMode !== "fulltext",
        scoutModel: variant.scoutModel ?? null,
        mainModel: variant.mainModel,
        retrievalLabel: retrievalLabel(resolvedRetrievalMode),
        scoredArtifact: "final-answer",
      },
    }))
  );

  const providers = new Map(variants.map((variant) => [variant.label, variant.createProvider()]));
  const workspaceRoot = await prepareAgentWorkspace();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await stopManagedServer();
      process.exit(1);
    });
  }

  await stopManagedServer();
  const state = await startManagedServerWithOptions(storageOptions(resolvedRetrievalMode, workspaceRoot));

  try {
    const result = await Eval("FreeContext", {
      experimentName: experimentName({ retrievalMode: resolvedRetrievalMode, group, variants, cases }),
      description: suite.description,
      data,
      maxConcurrency: 1,
      flushBeforeScoring: true,
      summarizeScores: true,
        metadata: {
        suite:
          resolvedRetrievalMode === "embedding"
            ? "braintrust-agent-embedding"
            : resolvedRetrievalMode === "hybrid"
              ? "braintrust-agent-hybrid"
              : "braintrust-agent",
        semantic: resolvedRetrievalMode !== "fulltext",
        retrievalMode: resolvedRetrievalMode,
      },
      tags: [
        "braintrust-native",
        `retrieval:${resolvedRetrievalMode}`,
      ],
      task: async (input, hooks) => {
        const provider = providers.get(input.providerLabel);
        if (!provider) {
          throw new Error(`No provider found for ${input.providerLabel}`);
        }

        const providerResult = await provider.callApi(input.prompt, {
          vars: {
            endpoint: state.endpoint,
            semantic: resolvedRetrievalMode !== "fulltext",
            retrievalMode: resolvedRetrievalMode,
          },
          test: {
            description: hooks.metadata.caseDescription,
            metadata: {
              suite: hooks.metadata.suite,
              category: hooks.metadata.category,
              expected: hooks.expected,
            },
          },
        });

        const variant = variants.find((candidate) => candidate.label === input.providerLabel);
        Object.assign(
          hooks.metadata,
          buildRowMetadata(
            hooks.metadata,
            variant,
            providerResult,
            workspaceRoot,
            state.endpoint,
            resolvedRetrievalMode
          )
        );

        return providerResult.output ?? "";
      },
      scores: [
        strictDeterministicScorer,
        llmJudgeScorer,
      ],
    });

    const outputPath = await writeSummaryFile(
      resolvedRetrievalMode === "embedding"
        ? "braintrust-agent-embedding"
        : resolvedRetrievalMode === "hybrid"
          ? "braintrust-agent-hybrid"
          : "braintrust-agent",
      result
    );

    process.stdout.write(`Braintrust summary: ${outputPath}\n`);
    process.stdout.write(`Cases: ${cases.length}, variants: ${variants.length}, rows: ${data.length}\n`);
    return { result, outputPath };
  } finally {
    await stopManagedServer();
  }
}
