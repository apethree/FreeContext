import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callOpenAiRaw = vi.fn();
const callOpenAiWithFreeContext = vi.fn();
const startManagedServerWithOptions = vi.fn();
const stopManagedServer = vi.fn();

vi.mock("../../evals/providers/agent-shared.js", () => ({
  callOpenAiRaw,
  callOpenAiWithFreeContext,
}));

vi.mock("../../evals/scripts/start-server.js", () => ({
  startManagedServerWithOptions,
}));

vi.mock("../../evals/scripts/stop-server.js", () => ({
  stopManagedServer,
}));

describe("eval harness providers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("routes the OpenRouter raw provider through the OpenRouter endpoint", async () => {
    process.env.OPENROUTER_API_KEY = "token";
    callOpenAiRaw.mockResolvedValue({ output: "ok" });
    const mod = await import("../../evals/providers/" + "openrouter-raw.js");
    const provider = new mod.default({ model: "qwen/qwen3.5-27b" });

    await provider.callApi("question", { vars: {} });

    expect(callOpenAiRaw).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({
        apiUrl: "https://openrouter.ai/api/v1/chat/completions",
        model: "qwen/qwen3.5-27b",
        apiKey: "token",
      })
    );
  });

  it("routes the OpenRouter FreeContext provider through the OpenRouter endpoint", async () => {
    process.env.OPENROUTER_API_KEY = "token";
    callOpenAiWithFreeContext.mockResolvedValue({ output: "ok" });
    const mod = await import("../../evals/providers/" + "openrouter-freecontext.js");
    const provider = new mod.default({ model: "stepfun/step-3.5-flash:free" });

    await provider.callApi("question", { vars: { endpoint: "http://127.0.0.1:3214/mcp" } });

    expect(callOpenAiWithFreeContext).toHaveBeenCalledWith(
      "question",
      "http://127.0.0.1:3214/mcp",
      expect.objectContaining({
        apiUrl: "https://openrouter.ai/api/v1/chat/completions",
        model: "stepfun/step-3.5-flash:free",
        apiKey: "token",
      })
    );
  });

  it("uses the fulltext endpoint override for the fulltext baseline provider", async () => {
    process.env.FREE_CONTEXT_FULLTEXT_MCP_ENDPOINT = "http://127.0.0.1:3216/mcp";
    callOpenAiWithFreeContext.mockResolvedValue({ output: "ok" });
    const mod = await import("../../evals/providers/" + "openai-freecontext-fulltext.js");
    const provider = new mod.default();

    await provider.callApi("question");

    expect(callOpenAiWithFreeContext).toHaveBeenCalledWith(
      "question",
      "http://127.0.0.1:3216/mcp"
    );
  });

  it("starts semantic evals with a remote openai-compatible embedding backend when configured", async () => {
    process.env.FREE_CONTEXT_EMBED_BASE_URL = "http://192.168.1.117:8002/v1";
    startManagedServerWithOptions.mockResolvedValue({
      endpoint: "http://127.0.0.1:3213/mcp",
    });
    const mod = await import("../../evals/scripts/" + "semantic-hooks.js");

    await mod.semanticEvalHook("beforeAll", {});

    expect(startManagedServerWithOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        embed: true,
        extraArgs: [
          "--embedder",
          "openai_compatible",
          "--embedding-base-url",
          "http://192.168.1.117:8002/v1",
        ],
      })
    );
    expect(process.env.FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT).toBe("http://127.0.0.1:3213/mcp");
  });
});
