import { resolve } from "node:path";
import { buildMainAgentLabel, buildScoutAgentLabel } from "../providers/provider-labels.js";

const DEFAULT_CONFIG = {
  anthropic: {
    route: "proxy",
    model: process.env.ANTHROPIC_AGENT_EVAL_MODEL ?? "claude-haiku-4-5-20251001",
    directBaseUrl:
      process.env.ANTHROPIC_DIRECT_BASE_URL ??
      (process.env.PROXY_API || process.env.PROXY_BASE_URL ? "" : process.env.ANTHROPIC_BASE_URL ?? ""),
    directApiKey:
      process.env.ANTHROPIC_DIRECT_API_KEY ??
      (process.env.PROXY_TOKEN || process.env.PROXY_API_KEY ? "" : process.env.ANTHROPIC_API_KEY ?? ""),
    proxyUrl: process.env.PROXY_API ?? "http://localhost:8317/v1",
    proxyToken: process.env.PROXY_TOKEN ?? "",
  },
  openai: {
    route: "proxy",
    model: process.env.OPENAI_AGENT_EVAL_MODEL ?? "gpt-5-codex-mini",
    directBaseUrl:
      process.env.OPENAI_DIRECT_BASE_URL ??
      (process.env.PROXY_API || process.env.PROXY_BASE_URL ? "" : process.env.OPENAI_BASE_URL ?? ""),
    directApiKey:
      process.env.OPENAI_DIRECT_API_KEY ??
      (process.env.PROXY_TOKEN || process.env.PROXY_API_KEY ? "" : process.env.OPENAI_API_KEY ?? ""),
    proxyUrl: process.env.PROXY_API ?? "http://localhost:8317/v1",
    proxyToken: process.env.PROXY_TOKEN ?? "",
  },
  scout: {
    source: "openrouter",
    preset: "qwen-27b",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl:
      process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL ??
      process.env.PROXY_API ??
      "http://127.0.0.1:11434/v1",
    model: process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL ?? "qwen/qwen3.5-27b",
    localApiKey:
      process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY ??
      process.env.PROXY_TOKEN ??
      "ollama",
  },
  run: {
    suite: "agent",
    group: "all",
    targetFilter: "",
    testFilter: "",
    outputFile: "",
  },
};

const LEGACY_SUITE_MAP = {
  semantic: "tool-embedding",
  "semantic-smoke": "tool-embedding-smoke",
  "tool-embed-smoke": "tool-embed-health",
  "agent-semantic": "agent-embedding",
  "agent-semantic-smoke": "agent-embedding-smoke",
};

function trimTrailingSlash(value = "") {
  return String(value).replace(/\/+$/, "");
}

function normalizeOpenAiBaseUrl(value = "") {
  if (!value) return "";
  const normalized = trimTrailingSlash(value);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function normalizeAnthropicBaseUrl(value = "") {
  if (!value) return "";
  const normalized = trimTrailingSlash(value);
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

export function defaultEvalControlConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

export function normalizeEvalSuiteName(suite = "agent") {
  return LEGACY_SUITE_MAP[suite] ?? suite;
}

export function mergeEvalControlConfig(source = {}) {
  const merged = defaultEvalControlConfig();
  return {
    anthropic: { ...merged.anthropic, ...(source.anthropic ?? {}) },
    openai: { ...merged.openai, ...(source.openai ?? {}) },
    scout: { ...merged.scout, ...(source.scout ?? {}) },
    run: { ...merged.run, ...(source.run ?? {}) },
  };
}

export function buildEvalControlEnv(config, baseEnv = process.env) {
  const merged = mergeEvalControlConfig(config);
  const env = { ...baseEnv };

  for (const key of [
    "PROXY_API",
    "PROXY_BASE_URL",
    "PROXY_TOKEN",
    "PROXY_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "OPENAI_AGENT_EVAL_MODEL",
    "ANTHROPIC_AGENT_EVAL_MODEL",
    "OPENROUTER_API_KEY",
    "FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL",
    "FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL",
    "FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY",
    "FREE_CONTEXT_LOCAL_SCOUT_BASE_URL",
    "FREE_CONTEXT_LOCAL_SCOUT_MODEL",
    "FREE_CONTEXT_LOCAL_SCOUT_API_KEY",
  ]) {
    delete env[key];
  }

  env.OPENAI_AGENT_EVAL_MODEL = merged.openai.model;
  env.ANTHROPIC_AGENT_EVAL_MODEL = merged.anthropic.model;

  if (merged.openai.route === "proxy") {
    env.OPENAI_BASE_URL = normalizeOpenAiBaseUrl(merged.openai.proxyUrl);
    env.OPENAI_API_KEY = merged.openai.proxyToken;
  } else {
    env.OPENAI_BASE_URL = merged.openai.directBaseUrl ? normalizeOpenAiBaseUrl(merged.openai.directBaseUrl) : "";
    env.OPENAI_API_KEY = merged.openai.directApiKey;
  }

  if (merged.anthropic.route === "proxy") {
    env.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrl(merged.anthropic.proxyUrl);
    env.ANTHROPIC_API_KEY = merged.anthropic.proxyToken;
  } else {
    env.ANTHROPIC_BASE_URL = merged.anthropic.directBaseUrl
      ? normalizeAnthropicBaseUrl(merged.anthropic.directBaseUrl)
      : "";
    env.ANTHROPIC_API_KEY = merged.anthropic.directApiKey;
  }

  if (merged.scout.source === "openrouter") {
    env.OPENROUTER_API_KEY = merged.scout.apiKey;
  } else {
    env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL = normalizeOpenAiBaseUrl(merged.scout.baseUrl);
    env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL = merged.scout.model;
    env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY = merged.scout.localApiKey;
    env.FREE_CONTEXT_LOCAL_SCOUT_BASE_URL = normalizeOpenAiBaseUrl(merged.scout.baseUrl);
    env.FREE_CONTEXT_LOCAL_SCOUT_MODEL = merged.scout.model;
    env.FREE_CONTEXT_LOCAL_SCOUT_API_KEY = merged.scout.localApiKey;
  }

  return env;
}

export function suiteScriptName(suite) {
  const normalizedSuite = normalizeEvalSuiteName(suite);
  const bySuite = {
    tool: "run-tool-evals.js",
    "tool-fulltext": "run-tool-fulltext-evals.js",
    "tool-fulltext-smoke": "run-tool-fulltext-smoke.js",
    "tool-embedding": "run-tool-embedding-evals.js",
    "tool-embedding-smoke": "run-tool-embedding-smoke.js",
    "tool-hybrid": "run-tool-hybrid-evals.js",
    "tool-hybrid-smoke": "run-tool-hybrid-smoke.js",
    "tool-embed-health": "run-tool-embed-smoke.js",
    agent: "run-agent-evals.js",
    "agent-smoke": "run-agent-smoke.js",
    "agent-embedding": "run-agent-embedding-evals.js",
    "agent-embedding-smoke": "run-agent-embedding-smoke.js",
    "agent-hybrid": "run-agent-hybrid-evals.js",
    "agent-hybrid-smoke": "run-agent-hybrid-smoke.js",
    "agent-scouts": "run-agent-scout-matrix.js",
    "agent-scouts-smoke": "run-agent-scout-smoke.js",
    edit: "run-edit-evals.js",
    "edit-smoke": "run-edit-smoke.js",
    semantic: "run-semantic-evals.js",
    "semantic-smoke": "run-semantic-smoke.js",
    "tool-embed-smoke": "run-tool-embed-smoke.js",
  };
  return bySuite[normalizedSuite] ?? "run-agent-evals.js";
}

export function availableEvalLabels(config) {
  const merged = mergeEvalControlConfig(config);
  const anthropicBase = buildMainAgentLabel({
    mainProvider: "anthropic",
    useMcp: false,
    model: merged.anthropic.model,
  });
  const anthropicFree = buildMainAgentLabel({
    mainProvider: "anthropic",
    useMcp: true,
    model: merged.anthropic.model,
  });
  const openaiBase = buildMainAgentLabel({
    mainProvider: "openai",
    useMcp: false,
    model: merged.openai.model,
  });
  const openaiFree = buildMainAgentLabel({
    mainProvider: "openai",
    useMcp: true,
    model: merged.openai.model,
  });
  const scoutPreset = merged.scout.source === "openrouter" ? merged.scout.preset : "openai-compatible";
  const anthropicScoutFree = buildScoutAgentLabel({
    mainProvider: "anthropic",
    scoutPreset,
    scoutModel: merged.scout.source === "openrouter" ? undefined : merged.scout.model,
    useMcp: true,
    model: merged.anthropic.model,
  });
  const openaiScoutFree = buildScoutAgentLabel({
    mainProvider: "openai",
    scoutPreset,
    scoutModel: merged.scout.source === "openrouter" ? undefined : merged.scout.model,
    useMcp: true,
    model: merged.openai.model,
  });

  const agent = [
    anthropicBase,
    anthropicFree,
    anthropicScoutFree,
    openaiBase,
    openaiFree,
    openaiScoutFree,
  ];

  return {
    agent,
    matrix: {
      anthropic: {
        defaultTools: anthropicBase,
        defaultToolsFreecontext: anthropicFree,
        scoutDefaultToolsFreecontext: anthropicScoutFree,
      },
      openai: {
        defaultTools: openaiBase,
        defaultToolsFreecontext: openaiFree,
        scoutDefaultToolsFreecontext: openaiScoutFree,
      },
    },
    scout: {
      source: merged.scout.source,
      preset: merged.scout.preset,
      model: merged.scout.model,
    },
  };
}

export function buildEvalRunSpec(config, request = {}) {
  const merged = mergeEvalControlConfig(config);
  const run = { ...merged.run, ...request };
  const suite = normalizeEvalSuiteName(run.suite);
  const args = ["evals/scripts/" + suiteScriptName(suite)];

  if (run.group && run.group !== "all") {
    args.push("--group", run.group);
  }
  if (run.targetFilter) {
    args.push("--filter-targets", run.targetFilter);
  }
  if (run.testFilter) {
    args.push("--filter-pattern", run.testFilter);
  }

  const outputFile = run.outputFile?.trim()
    ? run.outputFile.trim()
    : resolve("evals", ".promptfoo", `${suite}-${Date.now()}.json`);
  args.push("--no-table", "-o", outputFile);

  return {
    command: "node",
    args,
    outputFile,
    env: buildEvalControlEnv(merged),
  };
}
