#!/usr/bin/env node
/**
 * Web search smoke test — fast coverage check before running the full suite.
 *
 * 5 providers × 1 test = 5 runs (~90-120s)
 *
 * Covers all major code paths:
 *   1-claude-native-web       — Anthropic beta web_search tool
 *   3-claude-opencode-exa     — Exa /answer via opencode-mcp (synthesized answer)
 *   6a-openrouter-minimax-exa — MiniMax M2.5:free + OpenRouter Exa plugin
 *   6b-openrouter-stepfun-exa — StepFun 3.5:free + OpenRouter Exa plugin
 *   6c-openrouter-nemotron    — Nemotron 120B:free + OpenRouter Exa plugin
 *
 * Test: "npm releases" (shorter lookup task, no code generation)
 *
 * Usage:
 *   node evals/scripts/run-web-search-smoke.js
 *   npm run eval:websearch:smoke
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Bootstrap env
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
// Validate required keys
const missing = [];
if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
if (!process.env.OPENROUTER_API_KEY) missing.push("OPENROUTER_API_KEY");
if (!process.env.EXA_API_KEY) missing.push("EXA_API_KEY");
if (missing.length) {
  console.error(`\nMissing: ${missing.join(", ")}\n`);
  process.exit(1);
}

const PROVIDERS = [
  "1-claude-native-web",
  "3-claude-opencode-exa",
  "6a-openrouter-minimax-exa",
  "6b-openrouter-stepfun-exa",
  "6c-openrouter-nemotron-exa",
  "7-openrouter-openai-online",
  "8-openrouter-qwen-online",
].join("|");

console.log("\nWeb search smoke test");
console.log("  providers : 1-claude-native-web, 3-claude-opencode-exa, 6a minimax, 6b stepfun, 6c nemotron, 7-openai, 8-qwen");
console.log("  test      : npm releases lookup (test 2 only)");
console.log("  expected  : ~90-120s\n");

const args = [
  "promptfoo", "eval",
  "--config",          "evals/web-search-evals.yaml",
  "--output",          "evals/.promptfoo/web-search-smoke.json",
  "--filter-targets",  PROVIDERS,
  "--filter-pattern",  "npm releases",
  "--no-cache",
  ...process.argv.slice(2),
];

const child = spawn("npx", args, {
  env: { ...process.env },
  stdio: "inherit",
  cwd: REPO_ROOT,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => { child.kill(sig); process.exit(1); });
}

const code = await new Promise((res, rej) => {
  child.once("exit", (c) => res(c ?? 1));
  child.once("error", rej);
});

if (code === 0) {
  console.log("\nSmoke passed. Run full suite with: npm run eval:websearch\n");
}

process.exit(code);
