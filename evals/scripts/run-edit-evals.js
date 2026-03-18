import { spawn } from "node:child_process";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";
import { loadLocalEnv } from "./load-local-env.js";
import { prepareEditWorkspace } from "./prepare-workspace.js";
import { readArgValue, stripArgWithValue, writeFilteredPromptfooConfig } from "./promptfoo-provider-filter.js";

loadLocalEnv();
const rawArgs = process.argv.slice(2);
const hasUserTargetFilter = rawArgs.includes("--filter-targets");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

async function run() {
  const workspaceRoot = await prepareEditWorkspace();
  await stopManagedServer();
  const state = await startManagedServerWithOptions({
    port: Number(process.env.FREE_CONTEXT_EDIT_MCP_PORT ?? "3212"),
    storageDirName: "edit-free-context-db",
    workspaceRoot,
  });

  const effectiveFilter = hasUserTargetFilter ? readArgValue(rawArgs, "--filter-targets") : null;
  const configPath = writeFilteredPromptfooConfig("evals/edit-evals.yaml", effectiveFilter);
  const child = spawn("npx", ["promptfoo", "eval", "-c", configPath, ...stripArgWithValue(rawArgs, "--filter-targets")], {
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
