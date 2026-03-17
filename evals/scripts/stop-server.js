import { rm, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(SCRIPT_DIR, "..", ".promptfoo", "mcp-server.json");

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export async function stopManagedServer() {
  const state = await loadState();
  if (!state?.managed || typeof state.pid !== "number") {
    return;
  }

  if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isProcessAlive(state.pid)) {
        break;
      }
      await sleep(100);
    }

    if (isProcessAlive(state.pid)) {
      process.kill(state.pid, "SIGKILL");
    }
  }

  await rm(STATE_PATH, { force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await stopManagedServer();
}
