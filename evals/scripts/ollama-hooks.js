import { startManagedServer } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";

export async function ollamaEvalHook(hookName, context) {
  if (hookName === "beforeAll") {
    await stopManagedServer();
    const state = await startManagedServer();
    process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT = state.endpoint;
    return context;
  }

  if (hookName === "afterAll") {
    await stopManagedServer();
    delete process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT;
  }

  return context;
}
