import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

function activeLabels() {
  const labels = [];

  if (process.env.ANTHROPIC_API_KEY) {
    labels.push("anthropic-smoke");
  }

  if (process.env.OPENAI_API_KEY) {
    labels.push("openai-smoke");
  }

  if (process.env.OPENAI_COMPATIBLE_BASE_URL && process.env.OPENAI_COMPATIBLE_MODEL) {
    labels.push("openai-compatible-smoke");
  }

  return labels;
}

async function run() {
  const labels = activeLabels();
  if (labels.length === 0) {
    throw new Error(
      "No smoke-test providers are configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENAI_COMPATIBLE_BASE_URL with OPENAI_COMPATIBLE_MODEL."
    );
  }

  const args = [
    "promptfoo",
    "eval",
    "-c",
    "evals/agent-smoke.yaml",
    "--filter-targets",
    `^(${labels.join("|")})$`,
    ...process.argv.slice(2),
  ];

  const child = spawn("npx", args, {
    env: process.env,
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });

  process.exit(exitCode);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
