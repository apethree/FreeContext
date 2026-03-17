import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.js";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

/**
 * Semantic search smoke test — 2 tests covering both modes.
 *
 * Runs:
 *   semantic: "serialised async write operations"  → expects enqueueWrite
 *   hybrid:   "graph edges between source symbols" → expects EdgeExtractor
 *
 * Usage:
 *   npm run eval:semantic:smoke
 */

loadLocalEnv();

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEMANTIC_PORT = Number(process.env.FREE_CONTEXT_SEMANTIC_MCP_PORT ?? "3213");
const DEFAULT_STORAGE_PATH = resolve(REPO_ROOT, ".free-context", "db");
const SEMANTIC_STATE_KEY = "FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT";

console.log("\nSemantic smoke test");
console.log("  tests    : serialised async write (semantic) + graph edges (hybrid)");
console.log("  requires : --embed server (Qwen3-0.6B), starts automatically\n");

// If the user pre-set the endpoint, skip server management entirely
let ownedServer = false;
if (!process.env[SEMANTIC_STATE_KEY]) {
  await stopManagedServer();

  const storagePath = process.env.FREE_CONTEXT_SEMANTIC_ISOLATED_DB === "1"
    ? resolve(REPO_ROOT, "evals", ".promptfoo", "semantic-free-context-db")
    : DEFAULT_STORAGE_PATH;

  const embedBaseUrl = process.env.FREE_CONTEXT_EMBED_BASE_URL;
  const extraArgs = embedBaseUrl
    ? ["--embedder", "openai_compatible", "--embedding-base-url", embedBaseUrl]
    : [];

  const state = await startManagedServerWithOptions({
    port: SEMANTIC_PORT,
    storagePath,
    embed: true,
    extraArgs,
    healthTimeoutMs: 15 * 60_000,
  });
  process.env[SEMANTIC_STATE_KEY] = state.endpoint;
  ownedServer = true;
  console.log(`  ✓ Server ready at ${state.endpoint}\n`);
}

const child = spawn(
  "npx",
  [
    "promptfoo", "eval",
    "-c", "evals/semantic-tool-evals.yaml",
    "--filter-pattern", "serialised async|graph edges",
    ...process.argv.slice(2),
  ],
  // Pass the endpoint in the env so promptfoo worker threads see it at spawn time
  { env: { ...process.env }, stdio: "inherit", cwd: REPO_ROOT }
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => { child.kill(sig); process.exit(1); });
}

const code = await new Promise((res, rej) => {
  child.once("exit", (c) => res(c ?? 1));
  child.once("error", rej);
});

if (ownedServer) {
  await stopManagedServer();
}

if (code === 0) {
  console.log("\nSmoke passed. Run full suite with: npm run eval:semantic\n");
}

process.exit(code);
