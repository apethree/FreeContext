import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startManagedServer } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";
import { loadLocalEnv } from "./load-local-env.js";
import { prepareAgentWorkspace } from "./prepare-workspace.js";
import { buildTargetFilter } from "../providers/provider-labels.js";
import { activeAgentLabels } from "./agent-variant-matrix.js";
import { readArgValue, stripArgWithValue, writeFilteredPromptfooConfig } from "./promptfoo-provider-filter.js";

loadLocalEnv();

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// Optional group filter: --group openai | anthropic | all
// Or set PROVIDER_GROUP env var.
const groupArg = (() => {
  const idx = process.argv.indexOf("--group");
  return idx !== -1 ? process.argv[idx + 1] : (process.env.PROVIDER_GROUP ?? "all");
})();
const rawArgs = process.argv.slice(2);
const passthroughArgs = rawArgs.filter((a, i, arr) =>
  a !== "--group" && arr[i - 1] !== "--group"
);
const hasUserTargetFilter = rawArgs.includes("--filter-targets");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

function activeLabels(group) {
  return activeAgentLabels({ group });
}

async function run() {
  const labels = activeLabels(groupArg);
  if (labels.length === 0) {
    throw new Error(
      `No providers configured for group "${groupArg}". ` +
      `Set PROXY_API and PROXY_TOKEN, or set ANTHROPIC_API_KEY and/or OPENAI_API_KEY directly.`
    );
  }

  console.log(`Running group: ${groupArg} — providers: ${labels.join(", ")}`);

  const workspaceRoot = await prepareAgentWorkspace();
  await stopManagedServer();
  const state = await startManagedServer({
    workspaceRoot,
    storageDirName: "free-context-db",
  });
  const effectiveFilter = hasUserTargetFilter
    ? readArgValue(rawArgs, "--filter-targets")
    : buildTargetFilter(labels);
  const configPath = writeFilteredPromptfooConfig("evals/agent-evals.yaml", effectiveFilter);
  const args = [
    "promptfoo",
    "eval",
    "-c",
    configPath,
    ...stripArgWithValue(passthroughArgs, "--filter-targets"),
  ];

  const child = spawn("npx", args, {
    env: {
      ...process.env,
      FREE_CONTEXT_EVAL_MCP_ENDPOINT: state.endpoint,
      FREE_CONTEXT_EVAL_ROOT: workspaceRoot,
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
