import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startManagedServer } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_STORAGE_DIR = resolve(SCRIPT_DIR, "..", ".promptfoo", "tool-fulltext-db");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

async function run() {
  await stopManagedServer();
  await rm(TOOL_STORAGE_DIR, { recursive: true, force: true });
  const state = await startManagedServer();
  const args = [
    "promptfoo",
    "eval",
    "-c",
    "evals/tool-fulltext-evals.yaml",
    "--filter-pattern",
    "plugin routing through the gateway registry",
    ...process.argv.slice(2),
  ];
  const child = spawn("npx", args, {
    env: {
      ...process.env,
      FREE_CONTEXT_EVAL_MCP_ENDPOINT: state.endpoint,
      FREE_CONTEXT_EVAL_ROOT: state.workspaceRoot,
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });

  await stopManagedServer();
  if (exitCode === 0) {
    console.log("\nFulltext retrieval smoke passed. Run full suite with: npm run eval:tool:fulltext\n");
  }
  process.exit(exitCode);
}

try {
  await run();
} catch (error) {
  await stopManagedServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
