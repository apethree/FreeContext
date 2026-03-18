import { resolveScoutRuntime } from "./scout-models.js";

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_AGENT_EVAL_MODEL ?? "gpt-5-codex-mini";
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_AGENT_EVAL_MODEL ?? "claude-haiku-4-5-20251001";

function normalizeProvider(mainProvider = "") {
  if (mainProvider === "codex" || mainProvider === "openai") {
    return "openai";
  }
  if (mainProvider === "anthropic" || mainProvider === "claude") {
    return "anthropic";
  }
  return String(mainProvider || "unknown");
}

export function labelToken(value = "") {
  return String(value)
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function regexEscape(value = "") {
  return String(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

export function defaultMainModel(mainProvider) {
  return normalizeProvider(mainProvider) === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL;
}

export function buildMainAgentLabel({ mainProvider, useMcp = false, taskType = "agent", model } = {}) {
  const provider = normalizeProvider(mainProvider);
  const modelToken = labelToken(model ?? defaultMainModel(provider));
  const suffix = taskType === "edit" ? "-edit" : "";
  return `${provider}-${modelToken}-default-tools${useMcp ? "+freecontext" : ""}${suffix}`;
}

export function buildScoutAgentLabel({
  mainProvider,
  scoutModel,
  scoutPreset,
  useMcp = false,
  taskType = "agent",
  model,
} = {}) {
  const provider = normalizeProvider(mainProvider);
  const mainModelToken = labelToken(model ?? defaultMainModel(provider));
  const runtime = resolveScoutRuntime({ preset: scoutPreset, scoutModel, model: scoutModel });
  const scoutToken = labelToken(runtime.model);
  const suffix = taskType === "edit" ? "-edit" : "";
  return `${provider}-${mainModelToken}-scout-${scoutToken}-default-tools${useMcp ? "+freecontext" : ""}${suffix}`;
}

export function buildTargetFilter(labels = []) {
  return `^(${labels.map((label) => regexEscape(label)).join("|")})$`;
}
