import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.js";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

loadLocalEnv();

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EMBED_SMOKE_PORT = Number(process.env.FREE_CONTEXT_EMBED_SMOKE_MCP_PORT ?? "3215");
const EMBED_SMOKE_STATE_KEY = "FREE_CONTEXT_EVAL_MCP_ENDPOINT";

function resolveEmbedExtraArgs() {
  const embedBaseUrl = process.env.FREE_CONTEXT_EMBED_BASE_URL;
  if (!embedBaseUrl) {
    return [];
  }

  const extraArgs = ["--embedder", "openai_compatible", "--embedding-base-url", embedBaseUrl];
  if (process.env.FREE_CONTEXT_EMBED_MODEL_ID) {
    extraArgs.push("--embedding-model-id", process.env.FREE_CONTEXT_EMBED_MODEL_ID);
  }
  if (process.env.FREE_CONTEXT_EMBED_DIMENSIONS) {
    extraArgs.push("--embedding-dimensions", process.env.FREE_CONTEXT_EMBED_DIMENSIONS);
  }
  return extraArgs;
}

console.log("\nEmbed-enabled MCP health check");
console.log("  tools    : all MCP tools once, plus fulltext/embedding/hybrid search_code");
console.log("  backend  : local Ollama by default, or FREE_CONTEXT_EMBED_BASE_URL via openai_compatible\n");

let ownedServer = false;
if (!process.env[EMBED_SMOKE_STATE_KEY]) {
  await stopManagedServer();

  const extraArgs = resolveEmbedExtraArgs();

  const state = await startManagedServerWithOptions({
    port: EMBED_SMOKE_PORT,
    storageDirName: "free-context-embed-smoke-db",
    embed: true,
    extraArgs,
    healthTimeoutMs: 15 * 60_000,
  });
  process.env[EMBED_SMOKE_STATE_KEY] = state.endpoint;
  process.env.FREE_CONTEXT_EVAL_ROOT = state.workspaceRoot;
  ownedServer = true;
  console.log(`  ✓ Server ready at ${state.endpoint}\n`);
}

const child = spawn(
  "npx",
  [
    "promptfoo",
    "eval",
    "-c",
    "evals/tool-embed-smoke-evals.yaml",
    ...process.argv.slice(2),
  ],
  { env: { ...process.env }, stdio: "inherit", cwd: REPO_ROOT }
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => {
    child.kill(sig);
    process.exit(1);
  });
}

const code = await new Promise((res, rej) => {
  child.once("exit", (c) => res(c ?? 1));
  child.once("error", rej);
});

if (ownedServer) {
  await stopManagedServer();
}

if (code === 0) {
  console.log("\nEmbed-enabled MCP health check passed.\n");
}

process.exit(code);
