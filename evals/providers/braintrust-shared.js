import { initLogger, flush, currentSpan, NOOP_SPAN } from "braintrust";

let loggerInstance;

function getLogger() {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!loggerInstance) {
    loggerInstance = initLogger({
      projectName: process.env.BRAINTRUST_PROJECT ?? "FreeContext",
      apiKey,
      asyncFlush: true,
    });
  }

  return loggerInstance;
}

function safeData(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\w./:+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeExpected(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return safeData(value);
}

function deriveStrategy(metadata = {}) {
  const tier = metadata.tier ?? "";
  const useMcp = metadata.useMcp ?? (tier === "freecontext" || tier === "scout");
  const hasScout = typeof metadata.scoutModel === "string" || tier === "scout" || tier === "scout-base";

  if (hasScout && useMcp) {
    return "scout-bridge-freecontext";
  }
  if (hasScout) {
    return "scout-bridge";
  }
  if (useMcp) {
    return "direct-freecontext";
  }
  return "baseline";
}

export function buildEvalTraceOptions({ prompt, context, metadata = {} }) {
  const suite = context?.test?.metadata?.suite ?? metadata.suite;
  const category = context?.test?.metadata?.category ?? metadata.category;
  const testDescription = context?.test?.description ?? metadata.testDescription;
  const semantic = context?.vars?.semantic === true || metadata.semantic === true;
  const expected =
    normalizeExpected(context?.test?.metadata?.expected) ??
    normalizeExpected(context?.test?.expected) ??
    normalizeExpected(context?.vars?.expected);
  const strategy = metadata.strategy ?? deriveStrategy(metadata);
  const strategyLabel = metadata.strategyLabel;
  const tags = [
    suite ? `suite:${normalizeTag(suite)}` : null,
    category ? `category:${normalizeTag(category)}` : null,
    metadata.providerFamily ? `provider:${normalizeTag(metadata.providerFamily)}` : null,
    metadata.tier ? `tier:${normalizeTag(metadata.tier)}` : null,
    strategy ? `strategy:${normalizeTag(strategy)}` : null,
    metadata.mainModel ? `main-model:${normalizeTag(metadata.mainModel)}` : null,
    metadata.variantKey ? `variant:${normalizeTag(metadata.variantKey)}` : null,
    semantic ? "retrieval:semantic" : "retrieval:fulltext-graph",
    metadata.taskType ? `task:${normalizeTag(metadata.taskType)}` : null,
    metadata.scoutModel ? `scout:${normalizeTag(metadata.scoutModel)}` : null,
  ].filter(Boolean);

  return {
    name: "eval_case",
    input: {
      prompt,
      ...(testDescription ? { testDescription } : {}),
    },
    ...(expected !== undefined ? { expected } : {}),
    metadata: {
      ...metadata,
      ...(suite ? { suite } : {}),
      ...(category ? { category } : {}),
      ...(testDescription ? { testDescription } : {}),
      strategy,
      ...(strategyLabel ? { strategyLabel } : {}),
      semantic,
    },
    tags,
  };
}

function effectiveInputTokens(usage = {}) {
  return (usage.prompt ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function providerResultLogPayload(result) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const usage = result.tokenUsage;
  const metadata = result.metadata;
  const output = result.output;
  if (usage === undefined && metadata === undefined && output === undefined) {
    return null;
  }

  const metadataPayload = {
    ...(metadata ? safeData(metadata) : {}),
  };

  if (usage && typeof usage === "object") {
    metadataPayload.tokenUsage = safeData(usage);
    metadataPayload.promptTokens = usage.prompt ?? 0;
    metadataPayload.completionTokens = usage.completion ?? 0;
    metadataPayload.totalTokens = usage.total ?? ((usage.prompt ?? 0) + (usage.completion ?? 0));
    metadataPayload.cacheReadTokens = usage.cacheRead ?? 0;
    metadataPayload.cacheWriteTokens = usage.cacheWrite ?? 0;
    metadataPayload.effectiveInputTokens = effectiveInputTokens(usage);
    if (typeof usage.cost === "number") {
      metadataPayload.estimatedCostUsd = usage.cost;
    }
  }

  return {
    ...(output !== undefined ? { output: safeData(output) } : {}),
    ...(Object.keys(metadataPayload).length > 0 ? { metadata: metadataPayload } : {}),
    ...(typeof usage?.cost === "number"
      ? {
          metrics: {
            estimated_cost: usage.cost,
          },
        }
      : {}),
    ...(typeof metadata?.model === "string" ? { model: metadata.model } : {}),
  };
}

export function logProviderResult(span, result) {
  if (!span?.log) {
    return;
  }

  const payload = providerResultLogPayload(result);
  if (payload) {
    span.log(payload);
  }
}

export async function withEvalTrace({ name, input, expected, metadata, tags }, fn) {
  const activeSpan = currentSpan();
  if (activeSpan && activeSpan !== NOOP_SPAN && typeof activeSpan.traced === "function") {
    return activeSpan.traced(
      async (span) => {
        if (input !== undefined || metadata !== undefined) {
          span.log({
            ...(input !== undefined ? { input: safeData(input) } : {}),
            ...(expected !== undefined ? { expected: safeData(expected) } : {}),
            ...(metadata !== undefined ? { metadata: safeData(metadata) } : {}),
            ...(Array.isArray(tags) && tags.length > 0 ? { tags: safeData(tags) } : {}),
          });
        }
        const result = await fn(span);
        logProviderResult(span, result);
        return result;
      },
      {
        name,
        type: "task",
      }
    );
  }

  const logger = getLogger();
  if (!logger) {
    return fn(null);
  }

  const result = await logger.traced(
    async (span) => {
      if (input !== undefined || metadata !== undefined) {
        span.log({
          ...(input !== undefined ? { input: safeData(input) } : {}),
          ...(expected !== undefined ? { expected: safeData(expected) } : {}),
          ...(metadata !== undefined ? { metadata: safeData(metadata) } : {}),
          ...(Array.isArray(tags) && tags.length > 0 ? { tags: safeData(tags) } : {}),
        });
      }
      const result = await fn(span);
      logProviderResult(span, result);
      return result;
    },
    {
      name,
      type: "task",
    }
  );

  await flush();
  return result;
}

export async function withChildSpan(parentSpan, { name, input, metadata }, fn) {
  if (!parentSpan?.traced) {
    return fn(null);
  }

  return parentSpan.traced(
    async (span) => {
      if (input !== undefined || metadata !== undefined) {
        span.log({
          ...(input !== undefined ? { input: safeData(input) } : {}),
          ...(metadata !== undefined ? { metadata: safeData(metadata) } : {}),
        });
      }
      const result = await fn(span);
      logProviderResult(span, result);
      return result;
    },
    {
      name,
      type: "function",
    }
  );
}

export function logSpan(span, payload) {
  if (!span?.log) {
    return;
  }
  span.log(safeData(payload));
}
