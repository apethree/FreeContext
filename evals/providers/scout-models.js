const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const DEFAULT_LOCAL_SCOUT_BASE_URL =
  process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL ??
  process.env.FREE_CONTEXT_LOCAL_SCOUT_BASE_URL ??
  "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_SCOUT_MODEL =
  process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL ??
  process.env.FREE_CONTEXT_LOCAL_SCOUT_MODEL ??
  "llama3.3";
const DEFAULT_LOCAL_SCOUT_API_KEY =
  process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY ??
  process.env.FREE_CONTEXT_LOCAL_SCOUT_API_KEY ??
  "ollama";

const SCOUT_PRESETS = {
  "qwen-27b": {
    model: "qwen/qwen3.5-27b",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  "minimax-2.5": {
    model: "minimax/minimax-m2.5",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  "stepfun-3.5-flash": {
    model: "stepfun/step-3.5-flash",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  "grok-4.1-fast": {
    model: "x-ai/grok-4.1-fast",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  "nemotron-super": {
    model: "nvidia/nemotron-3-super-120b-a12b",
    baseUrl: OPENROUTER_BASE_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  "local-llama": {
    model: DEFAULT_LOCAL_SCOUT_MODEL,
    baseUrl: DEFAULT_LOCAL_SCOUT_BASE_URL,
    apiKey: DEFAULT_LOCAL_SCOUT_API_KEY,
  },
  "openai-compatible": {
    model: DEFAULT_LOCAL_SCOUT_MODEL,
    baseUrl: DEFAULT_LOCAL_SCOUT_BASE_URL,
    apiKey: DEFAULT_LOCAL_SCOUT_API_KEY,
  },
};

export function availableScoutPresets() {
  return Object.keys(SCOUT_PRESETS);
}

export function resolveScoutRuntime(options = {}) {
  const preset = options.scoutPreset ?? options.preset;
  const presetConfig = preset ? SCOUT_PRESETS[preset] : undefined;

  const model =
    options.model ??
    options.scoutModel ??
    presetConfig?.model ??
    process.env.FREE_CONTEXT_SCOUT_MODEL ??
    "qwen/qwen3.5-27b";
  const baseUrl =
    options.baseUrl ??
    options.scoutBaseUrl ??
    presetConfig?.baseUrl ??
    process.env.FREE_CONTEXT_SCOUT_BASE_URL ??
    OPENROUTER_BASE_URL;
  const apiKey =
    options.apiKey ??
    options.scoutApiKey ??
    presetConfig?.apiKey ??
    undefined;
  const apiKeyEnv =
    options.apiKeyEnv ??
    options.scoutApiKeyEnv ??
    presetConfig?.apiKeyEnv ??
    (baseUrl.includes("openrouter.ai") ? "OPENROUTER_API_KEY" : undefined);

  return {
    preset: preset ?? null,
    model,
    baseUrl,
    apiKey,
    apiKeyEnv,
  };
}
