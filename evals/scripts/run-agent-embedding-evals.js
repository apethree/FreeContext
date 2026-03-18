import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";
import { loadLocalEnv } from "./load-local-env.js";
import { prepareAgentWorkspace } from "./prepare-workspace.js";
import { buildTargetFilter } from "../providers/provider-labels.js";
import { activeAgentLabels } from "./agent-variant-matrix.js";
import { readArgValue, stripArgWithValue, writeFilteredPromptfooConfig } from "./promptfoo-provider-filter.js";

loadLocalEnv();
const rawArgs = process.argv.slice(2);
const hasUserTargetFilter = rawArgs.includes("--filter-targets");

const STORAGE_PATH = resolve(process.cwd(), "evals", ".promptfoo", "embedding-agent-db");
const PORT = Number(process.env.FREE_CONTEXT_EMBEDDING_AGENT_MCP_PORT ?? "3215");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

function activeLabels() {
  return activeAgentLabels({ semantic: true });
}

async function run() {
  const labels = activeLabels();
  if (labels.length === 0) {
    throw new Error("No embedding agent providers configured. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY.");
  }

  const workspaceRoot = await prepareAgentWorkspace();
  await stopManagedServer();
  const state = await startManagedServerWithOptions({
    port: PORT,
    storageDirName: "embedding-agent-db",
    storagePath: STORAGE_PATH,
    workspaceRoot,
    embed: true,
    healthTimeoutMs: 15 * 60_000,
  });

  const effectiveFilter = hasUserTargetFilter
    ? readArgValue(rawArgs, "--filter-targets")
    : buildTargetFilter(labels);
  const configPath = writeFilteredPromptfooConfig("evals/agent-embedding-evals.yaml", effectiveFilter);
  const args = [
    "promptfoo",
    "eval",
    "-c",
    configPath,
    ...stripArgWithValue(rawArgs, "--filter-targets"),
  ];

  const child = spawn(
    "npx",
    args,
    {
      env: {
        ...process.env,
        FREE_CONTEXT_EVAL_MCP_ENDPOINT: state.endpoint,
        FREE_CONTEXT_EVAL_ROOT: workspaceRoot,
      },
      stdio: "inherit",
    }
  );

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
