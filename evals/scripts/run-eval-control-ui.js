import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.js";
import {
  availableEvalLabels,
  buildEvalRunSpec,
  defaultEvalControlConfig,
  mergeEvalControlConfig,
  normalizeEvalSuiteName,
} from "./eval-control-shared.js";

loadLocalEnv();

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const UI_DIR = resolve(REPO_ROOT, "evals", "ui");
const CONFIG_PATH = resolve(REPO_ROOT, "evals", ".promptfoo", "eval-control-config.json");
const PORT = Number(process.env.FREE_CONTEXT_EVAL_UI_PORT ?? "3216");
const HOST = "127.0.0.1";

mkdirSync(resolve(REPO_ROOT, "evals", ".promptfoo"), { recursive: true });

const runs = new Map();

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return defaultEvalControlConfig();
  }

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return mergeEvalControlConfig(parsed);
  } catch {
    return defaultEvalControlConfig();
  }
}

function writeConfig(config) {
  const merged = mergeEvalControlConfig(config);
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const typeByExt = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };
  res.writeHead(200, { "content-type": typeByExt[extname(filePath)] ?? "text/plain; charset=utf-8" });
  createReadStream(filePath).pipe(res);
}

function collectBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        rejectPromise(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch (error) {
        rejectPromise(error);
      }
    });
    req.on("error", rejectPromise);
  });
}

function serializeRun(run) {
  return {
    id: run.id,
    suite: run.suite,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    command: [run.command, ...run.args].join(" "),
    outputFile: run.outputFile,
    logs: run.logs,
    exitCode: run.exitCode ?? null,
  };
}

function startRun(config, request) {
  const spec = buildEvalRunSpec(config, request);
  const id = `run-${Date.now()}`;
  const run = {
    id,
    suite: normalizeEvalSuiteName(request.suite ?? config.run?.suite ?? "agent"),
    status: "running",
    startedAt: new Date().toISOString(),
    command: spec.command,
    args: spec.args,
    outputFile: spec.outputFile,
    logs: "",
    exitCode: null,
  };
  runs.set(id, run);

  const child = spawn(spec.command, spec.args, {
    cwd: REPO_ROOT,
    env: spec.env,
  });

  const append = (chunk) => {
    run.logs += chunk.toString();
    if (run.logs.length > 200_000) {
      run.logs = run.logs.slice(-200_000);
    }
  };

  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code) => {
    run.status = code === 0 ? "completed" : "failed";
    run.exitCode = code ?? 1;
    run.finishedAt = new Date().toISOString();
  });
  child.on("error", (error) => {
    append(String(error));
    run.status = "failed";
    run.exitCode = 1;
    run.finishedAt = new Date().toISOString();
  });

  return serializeRun(run);
}

function routeStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(UI_DIR, `.${pathname}`);
  if (!filePath.startsWith(UI_DIR) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  sendFile(res, filePath);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      const config = readConfig();
      return sendJson(res, 200, { config, labels: availableEvalLabels(config) });
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      const body = await collectBody(req);
      const config = writeConfig(body.config ?? body);
      return sendJson(res, 200, { config, labels: availableEvalLabels(config) });
    }

    if (req.method === "POST" && url.pathname === "/api/config/defaults") {
      const config = writeConfig(defaultEvalControlConfig());
      return sendJson(res, 200, { config, labels: availableEvalLabels(config) });
    }

    if (req.method === "GET" && url.pathname === "/api/runs") {
      const ordered = [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return sendJson(res, 200, { runs: ordered.map(serializeRun) });
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      const body = await collectBody(req);
      const config = readConfig();
      const run = startRun(config, body);
      return sendJson(res, 200, { run, labels: availableEvalLabels(config) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/runs/")) {
      const id = url.pathname.split("/").pop();
      const run = id ? runs.get(id) : null;
      if (!run) {
        return sendJson(res, 404, { error: "Run not found" });
      }
      return sendJson(res, 200, { run: serializeRun(run) });
    }

    return routeStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Eval control UI: http://${HOST}:${PORT}\n`);
  process.stdout.write(`Promptfoo viewer: http://localhost:15500/\n`);
});
