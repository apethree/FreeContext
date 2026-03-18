import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.js";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

loadLocalEnv();

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_STORAGE_PATH = resolve(REPO_ROOT, ".free-context", "db");
const EMBEDDING_PORT = Number(
  process.env.FREE_CONTEXT_EMBEDDING_MCP_PORT ??
  process.env.FREE_CONTEXT_SEMANTIC_MCP_PORT ??
  "3213"
);
const EMBEDDING_STATE_KEY = "FREE_CONTEXT_EMBEDDING_MCP_ENDPOINT";
const LEGACY_STATE_KEY = "FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT";

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

export async function runEmbedToolSuite({
  title,
  summary,
  configPath,
  filterPattern,
  successMessage,
} = {}) {
  console.log(`\n${title}`);
  console.log(`  tests    : ${summary}`);
  console.log("  backend  : local Ollama by default, or FREE_CONTEXT_EMBED_BASE_URL via openai_compatible");
  console.log("  storage  : .free-context/db by default (set FREE_CONTEXT_SEMANTIC_ISOLATED_DB=1 for an isolated eval DB)");
  console.log("  workspace: evals/workspaces/oneshot-platform-fixture\n");

  const presetEndpoint = process.env[EMBEDDING_STATE_KEY] ?? process.env[LEGACY_STATE_KEY];
  let ownedServer = false;
  if (presetEndpoint) {
    process.env[EMBEDDING_STATE_KEY] = presetEndpoint;
    process.env[LEGACY_STATE_KEY] = presetEndpoint;
  } else {
    await stopManagedServer();

    const extraArgs = resolveEmbedExtraArgs();
    const state = await startManagedServerWithOptions({
      port: EMBEDDING_PORT,
      storagePath:
        process.env.FREE_CONTEXT_SEMANTIC_ISOLATED_DB === "1"
          ? resolve(REPO_ROOT, "evals", ".promptfoo", "semantic-free-context-db")
          : DEFAULT_STORAGE_PATH,
      embed: true,
      extraArgs,
      healthTimeoutMs: 15 * 60_000,
    });
    process.env[EMBEDDING_STATE_KEY] = state.endpoint;
    process.env[LEGACY_STATE_KEY] = state.endpoint;
    process.env.FREE_CONTEXT_EVAL_ROOT = state.workspaceRoot;
    ownedServer = true;
    console.log(`  ✓ Server ready at ${state.endpoint}\n`);
  }

  const args = ["promptfoo", "eval", "-c", configPath];
  if (filterPattern) {
    args.push("--filter-pattern", filterPattern);
  }
  args.push(...process.argv.slice(2));

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

  const code = await new Promise((res, rej) => {
    child.once("exit", (c) => res(c ?? 1));
    child.once("error", rej);
  });

  if (ownedServer) {
    await stopManagedServer();
  }

  if (code === 0 && successMessage) {
    console.log(`\n${successMessage}\n`);
  }

  process.exit(code);
}
