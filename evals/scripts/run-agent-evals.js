import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startManagedServer } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_STORAGE_DIR = resolve(SCRIPT_DIR, "..", ".promptfoo", "free-context-db");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

function activeLabels() {
  const labels = [];

  if (process.env.ANTHROPIC_API_KEY) {
    labels.push("anthropic-raw \\(no tools\\)", "anthropic-freecontext \\(MCP tools\\)");
  }

  if (process.env.OPENAI_API_KEY) {
    labels.push("openai-raw \\(no tools\\)", "openai-freecontext \\(MCP tools\\)");
  }

  return labels;
}

async function run() {
  const labels = activeLabels();
  if (labels.length === 0) {
    throw new Error(
      "No agent eval providers are configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
    );
  }

  await stopManagedServer();
  await rm(AGENT_STORAGE_DIR, { recursive: true, force: true });
  const state = await startManagedServer();
  const filter = `^(${labels.join("|")})$`;
  const args = [
    "promptfoo",
    "eval",
    "-c",
    "evals/agent-evals.yaml",
    "--filter-targets",
    filter,
    ...process.argv.slice(2),
  ];

  const child = spawn("npx", args, {
    env: {
      ...process.env,
      FREE_CONTEXT_EVAL_MCP_ENDPOINT: state.endpoint,
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });

  await stopManagedServer();
  process.exit(exitCode);
}

try {
  await run();
} catch (error) {
  await stopManagedServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
