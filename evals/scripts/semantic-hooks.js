import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_SEMANTIC_STORAGE_PATH = resolve(REPO_ROOT, ".free-context", "db");
const ISOLATED_SEMANTIC_STORAGE_PATH = resolve(
  SCRIPT_DIR,
  "..",
  ".promptfoo",
  "semantic-free-context-db"
);
const SEMANTIC_PORT = Number(process.env.FREE_CONTEXT_SEMANTIC_MCP_PORT ?? "3213");
const SEMANTIC_STATE_KEY = "FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT";

export async function semanticEvalHook(hookName, context) {
  if (hookName === "beforeAll") {
    console.log("\n── Semantic eval setup ──────────────────────────────────");

    // If the user already has an embed-enabled server running, reuse it.
    // Set FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT=http://127.0.0.1:<port>/mcp to skip spawning.
    const presetEndpoint = process.env[SEMANTIC_STATE_KEY];
    if (presetEndpoint) {
      console.log(`  mode        : external server (pre-set ${SEMANTIC_STATE_KEY})`);
      console.log(`  endpoint    : ${presetEndpoint}`);
      console.log(`  NOTE        : make sure this server was started with --embed`);
      console.log("────────────────────────────────────────────────────────\n");
      return context;
    }

    const rebuild = process.env.FREE_CONTEXT_SEMANTIC_REBUILD === "1";
    const useIsolatedDb = process.env.FREE_CONTEXT_SEMANTIC_ISOLATED_DB === "1";
    const embedBaseUrl = process.env.FREE_CONTEXT_EMBED_BASE_URL;
    const storagePath = useIsolatedDb
      ? ISOLATED_SEMANTIC_STORAGE_PATH
      : DEFAULT_SEMANTIC_STORAGE_PATH;
    const dbExists = existsSync(storagePath);
    const extraArgs = embedBaseUrl
      ? ["--embedder", "openai_compatible", "--embedding-base-url", embedBaseUrl]
      : [];
    const embedModeDesc = embedBaseUrl
      ? `remote openai_compatible (${embedBaseUrl})`
      : "local Ollama (http://127.0.0.1:11434)";

    console.log(`  port        : ${SEMANTIC_PORT}`);
    console.log(`  storage     : ${storagePath}`);
    console.log(`  db exists   : ${dbExists ? "yes (warm start)" : "no  (cold start — first run will be slow)"}`);
    console.log(`  rebuild     : ${rebuild ? "yes (FREE_CONTEXT_SEMANTIC_REBUILD=1)" : "no"}`);
    console.log(`  embed mode  : ${embedModeDesc}${dbExists && !rebuild ? " (already indexed)" : " (first run will build embeddings)"}`);
    console.log(`  tip         : set FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT to reuse a running --embed server`);

    await stopManagedServer();

    if (rebuild || !dbExists) {
      if (rebuild) console.log("\n  Removing existing DB for rebuild…");
      await rm(storagePath, { recursive: true, force: true });
    }

    console.log("\n  Starting MCP server with --embed…");
    console.log("  Server logs → evals/.promptfoo/mcp-server.log");
    console.log("  (tail -f evals/.promptfoo/mcp-server.log for live output)\n");

    const state = await startManagedServerWithOptions({
      port: SEMANTIC_PORT,
      storageDirName: useIsolatedDb ? "semantic-free-context-db" : "repo-free-context-db",
      storagePath,
      embed: true,
      extraArgs,
      healthTimeoutMs: 15 * 60_000,
    });

    console.log(`\n  ✓ Server ready at ${state.endpoint}`);
    console.log("────────────────────────────────────────────────────────\n");

    process.env[SEMANTIC_STATE_KEY] = state.endpoint;
    return context;
  }

  if (hookName === "afterAll") {
    // Don't stop a server the user provided externally
    if (!process.env[SEMANTIC_STATE_KEY]) return context;
    console.log("\n── Semantic eval teardown ───────────────────────────────");
    await stopManagedServer();
    delete process.env[SEMANTIC_STATE_KEY];
    console.log("  ✓ Server stopped");
    console.log("────────────────────────────────────────────────────────\n");
  }

  return context;
}
