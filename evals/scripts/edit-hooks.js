import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startManagedServerWithOptions } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EDIT_STORAGE_DIR = resolve(SCRIPT_DIR, "..", ".promptfoo", "edit-free-context-db");
const EDIT_PORT = Number(process.env.FREE_CONTEXT_EDIT_MCP_PORT ?? "3212");

export async function editEvalHook(hookName, context) {
  if (hookName === "beforeAll") {
    await stopManagedServer();
    await rm(EDIT_STORAGE_DIR, { recursive: true, force: true });
    const state = await startManagedServerWithOptions({
      port: EDIT_PORT,
      storageDirName: "edit-free-context-db",
    });
    process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT = state.endpoint;
    process.env.FREE_CONTEXT_EVAL_ROOT = state.workspaceRoot;
    return context;
  }

  if (hookName === "afterAll") {
    await stopManagedServer();
  }

  return context;
}
