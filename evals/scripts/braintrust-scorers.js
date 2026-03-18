import { resolveScoutRuntime } from "../providers/scout-models.js";

function safeString(value) {
  return String(value ?? "");
}

function countMatchingChecks(checks = [], output = "", metadata = {}) {
  const failures = [];
  let passed = 0;

  for (const check of checks) {
    if (check.type === "contains") {
      const ok = safeString(output).includes(check.value);
      if (ok) {
        passed += 1;
      } else {
        failures.push(`missing:${check.value}`);
      }
      continue;
    }

    if (check.type === "not-contains") {
      const ok = !safeString(output).includes(check.value);
      if (ok) {
        passed += 1;
      } else {
        failures.push(`unexpected:${check.value}`);
      }
      continue;
    }

    if (check.type === "tool-contract") {
      const tier = metadata.tier;
      const localToolCount = metadata.localToolCount ?? metadata.mainLocalToolCount ?? 0;
      const mcpToolCount = metadata.mcpToolCount ?? metadata.mainMcpToolCount ?? 0;
      const scoutMcpToolCount = metadata.scoutMcpToolCount ?? 0;
      const ok =
        (tier === "base" && localToolCount > 0 && mcpToolCount === 0) ||
        (tier === "freecontext" && localToolCount > 0 && mcpToolCount > 0) ||
        (tier === "scout" && localToolCount > 0 && mcpToolCount > 0 && scoutMcpToolCount > 0);
      if (ok) {
        passed += 1;
      } else {
        failures.push(`tool-contract:tier=${tier ?? "unknown"}`);
      }
    }
  }

  return {
    passed,
    total: checks.length,
    failures,
  };
}

function scoreMetadata(metadata = {}, extra = {}) {
  return {
    strategy: metadata.strategy,
    strategyLabel: metadata.strategyLabel,
    variantDisplayName: metadata.variantDisplayName,
    providerFamily: metadata.providerFamily,
    mainModel: metadata.mainModel,
    scoutModel: metadata.scoutModel ?? null,
    retrievalLabel: metadata.retrievalLabel,
    scoredArtifact: "final-answer",
    scoredPhase: "final-output",
    ...extra,
  };
}

function graderRuntime() {
  if (process.env.BRAINTRUST_GRADER_BASE_URL && process.env.BRAINTRUST_GRADER_MODEL) {
    return {
      model: process.env.BRAINTRUST_GRADER_MODEL,
      baseUrl: process.env.BRAINTRUST_GRADER_BASE_URL,
      apiKey:
        process.env.BRAINTRUST_GRADER_API_KEY ??
        (process.env.BRAINTRUST_GRADER_API_KEY_ENV
          ? process.env[process.env.BRAINTRUST_GRADER_API_KEY_ENV]
          : undefined),
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    const runtime = resolveScoutRuntime({
      preset: process.env.BRAINTRUST_GRADER_PRESET ?? "qwen-27b",
    });
    return {
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey ?? (runtime.apiKeyEnv ? process.env[runtime.apiKeyEnv] : undefined),
    };
  }

  if (
    process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL ||
    process.env.FREE_CONTEXT_LOCAL_SCOUT_BASE_URL
  ) {
    const runtime = resolveScoutRuntime({
      preset: process.env.BRAINTRUST_GRADER_PRESET ?? "openai-compatible",
    });
    return {
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey ?? (runtime.apiKeyEnv ? process.env[runtime.apiKeyEnv] : undefined),
    };
  }

  if (process.env.PROXY_API && process.env.PROXY_TOKEN) {
    return {
      model: process.env.BRAINTRUST_GRADER_MODEL ?? "claude-haiku-4-5-20251001",
      baseUrl: process.env.PROXY_API,
      apiKey: process.env.PROXY_TOKEN,
    };
  }

  return null;
}

function completionUrl(baseUrl) {
  const normalized = String(baseUrl).replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const match = trimmed.match(/\{[\s\S]*\}$/);
  if (!match) {
    throw new Error("Could not parse grader JSON response");
  }
  return JSON.parse(match[0]);
}

async function gradeWithLlm({ input, output, expected, metadata, trace }) {
  const runtime = graderRuntime();
  if (!runtime || expected == null) {
    return null;
  }

  let allSpans = [];
  let llmSpans = [];
  try {
    allSpans = trace ? await trace.getSpans() : [];
  } catch {}
  try {
    llmSpans = trace ? await trace.getSpans({ spanType: ["llm"] }) : [];
  } catch {}
  const response = await fetch(completionUrl(runtime.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(runtime.apiKey ? { authorization: `Bearer ${runtime.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: runtime.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are grading a code-intelligence benchmark. Return strict JSON only with keys correctness, completeness, and rationale. correctness and completeness must be numbers between 0 and 1.",
        },
        {
          role: "user",
          content:
            `Input:\n${safeString(input?.prompt ?? input)}\n\n` +
            `Expected:\n${safeString(expected)}\n\n` +
            `Output:\n${safeString(output)}\n\n` +
            `Metadata:\n${JSON.stringify({
              providerFamily: metadata.providerFamily,
              strategy: metadata.strategy,
              semantic: metadata.semantic,
            }, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Braintrust grader request failed: ${response.status}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content ?? "";
  const scored = extractJsonObject(safeString(text));
  const correctness = Number(scored.correctness);
  const completeness = Number(scored.completeness);

  return [
    {
      name: "FinalAnswerCorrectness",
      score: Number.isFinite(correctness) ? Math.max(0, Math.min(1, correctness)) : 0,
      metadata: scoreMetadata(metadata, {
        rationale: scored.rationale ?? null,
        graderModel: runtime.model,
        totalSpanCount: allSpans.length,
        llmSpanCount: llmSpans.length,
      }),
    },
    {
      name: "FinalAnswerCompleteness",
      score: Number.isFinite(completeness) ? Math.max(0, Math.min(1, completeness)) : 0,
      metadata: scoreMetadata(metadata, {
        rationale: scored.rationale ?? null,
        graderModel: runtime.model,
        totalSpanCount: allSpans.length,
        llmSpanCount: llmSpans.length,
      }),
    },
  ];
}

export function strictDeterministicScorer({ output, metadata }) {
  const checks = Array.isArray(metadata?.checks) ? metadata.checks : [];
  if (checks.length === 0) {
    return null;
  }

  const { passed, total, failures } = countMatchingChecks(checks, output, metadata);
  const fraction = total > 0 ? passed / total : 0;

  return [
    {
      name: "FinalAnswerStrictPass",
      score: passed === total ? 1 : 0,
      metadata: scoreMetadata(metadata, {
        passedChecks: passed,
        totalChecks: total,
        failures,
      }),
    },
    {
      name: "FinalAnswerStrictFraction",
      score: fraction,
      metadata: scoreMetadata(metadata, {
        passedChecks: passed,
        totalChecks: total,
        failures,
      }),
    },
  ];
}

export async function llmJudgeScorer(args) {
  try {
    return await gradeWithLlm(args);
  } catch {
    return null;
  }
}
