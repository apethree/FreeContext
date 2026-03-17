#!/usr/bin/env node
/**
 * Runner for web-search-evals.yaml
 *
 * Usage:
 *   node evals/scripts/run-web-search-evals.js
 *   node evals/scripts/run-web-search-evals.js --filter-targets "1-claude-native-web"
 *   node evals/scripts/run-web-search-evals.js --no-cache
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY (or set via .env.local)
 *   - OPENROUTER_API_KEY                  (for providers 5, 6, 7, and 8)
 *   - Proxy running at localhost:8317      (for provider 2, Gemini MCP)
 *
 * Results written to: evals/.promptfoo/web-search-results.json
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");

// Load .env.local before checking keys
const { existsSync, readFileSync } = await import("node:fs");
for (const envFile of [resolve(REPO_ROOT, ".env.local"), resolve(REPO_ROOT, ".env")]) {
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim();
    if (!key || process.env[key]) continue;
    let val = trimmed.slice(sep + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// ── check required keys ───────────────────────────────────────────────────

const missing = [];
if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
if (!process.env.EXA_API_KEY) missing.push("EXA_API_KEY");

if (missing.length) {
  console.error(`\nMissing required env vars: ${missing.join(", ")}`);
  console.error("Set them in .env.local or export before running.\n");
  process.exit(1);
}

if (!process.env.OPENROUTER_API_KEY) {
  console.warn(
    "\nWARN: OPENROUTER_API_KEY not set — providers 5, 6, 7, and 8 will fail.\n" +
      "      Set OPENROUTER_API_KEY in .env.local or your shell to enable them.\n"
  );
} else {
  console.warn(
    "\nNOTE (OpenRouter providers 6a/6b/6c): If you get 404 'No endpoints available',\n" +
      "      go to https://openrouter.ai/settings/privacy and enable\n" +
      "      'Allow providers to train on your prompts' or adjust data policy.\n" +
      "      Free models require relaxed privacy settings on OpenRouter.\n"
  );
}

// ── determine which providers to run ─────────────────────────────────────

function activeLabels() {
  const all = [
    "1-claude-native-web",
    "2-claude-gemini-mcp",
    "3-claude-opencode-exa",
    "4-claude-context7",
    "5-claude-scout-agent",
    "6a-openrouter-minimax-exa",
    "6b-openrouter-stepfun-exa",
    "6c-openrouter-nemotron-exa",
    "7-openrouter-openai-online",
    "8-openrouter-qwen-online",
  ].filter(Boolean);

  // Skip OpenRouter providers if no key
  if (!process.env.OPENROUTER_API_KEY) {
    return all.filter(
      (l) =>
        !l.startsWith("5") &&
        !l.startsWith("6") &&
        !l.startsWith("7") &&
        !l.startsWith("8")
    );
  }

  return all;
}

const labels = activeLabels();
console.log(`\nRunning ${labels.length} providers:\n  ${labels.join("\n  ")}\n`);

const args = [
  "promptfoo",
  "eval",
  "--config",
  "evals/web-search-evals.yaml",
  "--output",
  "evals/.promptfoo/web-search-results.json",
  "--filter-targets",
  labels.map((l) => `^${l}$`).join("|"),
  ...process.argv.slice(2),
];

const child = spawn("npx", args, {
  env: { ...process.env },
  stdio: "inherit",
  cwd: REPO_ROOT,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => {
    child.kill(sig);
    process.exit(1);
  });
}

const exitCode = await new Promise((resolve, reject) => {
  child.once("exit", (code) => resolve(code ?? 1));
  child.once("error", reject);
});

if (exitCode === 0) {
  console.log(
    "\nDone. View results:\n" +
      "  npx promptfoo view\n" +
      "  cat evals/.promptfoo/web-search-results.json\n"
  );
}

process.exit(exitCode);
