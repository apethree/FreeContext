import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CACHE_DIR = resolve(REPO_ROOT, "evals", ".promptfoo");
const STATE_PATH = resolve(CACHE_DIR, "mcp-server.json");
const LOG_PATH = resolve(CACHE_DIR, "mcp-server.log");
const DEFAULT_PORT = Number(process.env.FREE_CONTEXT_EVAL_MCP_PORT ?? "3214");
const DEFAULT_WORKSPACE_ROOT = resolve(REPO_ROOT, "evals", "workspaces", "oneshot-platform-fixture");

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureBuild() {
  const cliPath = resolve(REPO_ROOT, "dist", "cli", "index.js");
  if (await fileExists(cliPath)) {
    return cliPath;
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`npm run build exited with code ${code ?? "null"}`));
    });
    child.once("error", rejectPromise);
  });

  return cliPath;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function writeState(state) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function waitForHealth(url, timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastLogSec = -1;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(500);
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    // Log every 10 seconds so the user knows it's still working
    if (elapsedSec > 0 && elapsedSec % 10 === 0 && elapsedSec !== lastLogSec) {
      lastLogSec = elapsedSec;
      const hint = elapsedSec < 30
        ? "(indexing…)"
        : elapsedSec < 120
        ? "(downloading embed model or indexing with embeddings…)"
        : "(large repo or slow disk — still working…)";
      process.stderr.write(`  waiting for server health… ${elapsedSec}s ${hint}\n`);
    }
  }

  throw new Error(`Timed out waiting for MCP health check at ${url} after ${Math.round(timeoutMs / 1000)}s`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startManagedServer() {
  return startManagedServerWithOptions();
}

export async function startManagedServerWithOptions(options = {}) {
  const overrideEndpoint = process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ?? process.env.MCP_SERVER_URL;
  const workspaceRoot = resolve(
    options.workspaceRoot ?? process.env.FREE_CONTEXT_EVAL_WORKSPACE ?? DEFAULT_WORKSPACE_ROOT
  );
  if (overrideEndpoint) {
    return {
      endpoint: overrideEndpoint,
      healthUrl: overrideEndpoint.replace(/\/mcp$/, "/health"),
      managed: false,
      workspaceRoot,
    };
  }

  const storageDirName = options.storageDirName ?? "free-context-db";
  const storagePath = options.storagePath
    ? resolve(REPO_ROOT, options.storagePath)
    : resolve(CACHE_DIR, storageDirName);
  const port = Number(options.port ?? DEFAULT_PORT);
  const embed = options.embed ?? false;
  const extraArgs = options.extraArgs ?? [];
  const healthTimeoutMs = Number(options.healthTimeoutMs ?? 180_000);
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const healthUrl = `http://127.0.0.1:${port}/health`;

  const existing = await loadState();
  if (
    existing?.managed &&
    existing?.storageDirName === storageDirName &&
    existing?.storagePath === storagePath &&
    existing?.workspaceRoot === workspaceRoot &&
    existing?.port === port &&
    typeof existing.pid === "number" &&
    isProcessAlive(existing.pid)
  ) {
    process.stderr.write(`  Reusing existing managed server (pid ${existing.pid}, port ${port})\n`);
    await waitForHealth(existing.healthUrl ?? healthUrl, Math.min(healthTimeoutMs, 10_000));
    return existing;
  }

  await rm(STATE_PATH, { force: true });
  await mkdir(CACHE_DIR, { recursive: true });
  process.stderr.write(
    `  Spawning server on port ${port}${embed ? " --embed" : ""}, workspace: ${workspaceRoot}, storage: ${storagePath}\n`
  );
  const cliPath = await ensureBuild();
  const logStream = createWriteStream(LOG_PATH, { flags: "a" });
  const serverArgs = [
    cliPath,
      "serve",
      ".",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--storage",
    "lancedb",
    "--storage-path",
    storagePath,
    ...( embed ? ["--embed"] : []),
    ...extraArgs,
  ];

  const child = spawn(
    process.execPath,
    serverArgs,
    {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  const state = {
    pid: child.pid,
    port,
    endpoint,
    healthUrl,
    managed: true,
    storageDirName,
    storagePath,
    workspaceRoot,
  };
  await writeState(state);
  await waitForHealth(healthUrl, healthTimeoutMs);
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = await startManagedServerWithOptions();
  process.stdout.write(`${state.endpoint}\n`);
}
