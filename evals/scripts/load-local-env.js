import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

export function loadLocalEnv() {
  for (const envPath of [resolve(REPO_ROOT, ".env.local"), resolve(REPO_ROOT, ".env")]) {
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

  normalizeProxyEnv();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeOpenAiBaseUrl(value) {
  const normalized = trimTrailingSlash(value);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function normalizeAnthropicBaseUrl(value) {
  const normalized = trimTrailingSlash(value);
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

function setIfMissing(key, value) {
  if (!value || process.env[key]) {
    return;
  }
  process.env[key] = value;
}

function normalizeProxyEnv() {
  const proxyApi = process.env.PROXY_API ?? process.env.PROXY_BASE_URL;
  const proxyToken = process.env.PROXY_TOKEN ?? process.env.PROXY_API_KEY;
  const openRouterToken = process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY;

  if (proxyApi) {
    const openAiBaseUrl = normalizeOpenAiBaseUrl(proxyApi);
    const anthropicBaseUrl = normalizeAnthropicBaseUrl(proxyApi);
    process.env.PROXY_API = openAiBaseUrl;
    process.env.PROXY_BASE_URL = anthropicBaseUrl;
    process.env.OPENAI_BASE_URL = openAiBaseUrl;
    process.env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
  }

  if (proxyToken) {
    process.env.PROXY_TOKEN = proxyToken;
    process.env.PROXY_API_KEY = proxyToken;
    process.env.OPENAI_API_KEY = proxyToken;
    process.env.ANTHROPIC_API_KEY = proxyToken;
  }

  if (openRouterToken) {
    process.env.OPENROUTER_API_KEY = openRouterToken;
  }

  setIfMissing("OPENAI_AGENT_EVAL_MODEL", "gpt-5-codex-mini");
  setIfMissing("ANTHROPIC_AGENT_EVAL_MODEL", "claude-haiku-4-5-20251001");
  if (process.env.BRAINTRUST_API_KEY) {
    setIfMissing("BRAINTRUST_PROJECT", "FreeContext");
  }
}
