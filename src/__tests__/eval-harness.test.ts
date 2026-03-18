import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callClaudeAgent = vi.fn();
const callCodexAgent = vi.fn();
const callScoutWithAgent = vi.fn();
const callQwenScout = vi.fn();
const startManagedServerWithOptions = vi.fn();
const stopManagedServer = vi.fn();

vi.mock("../../evals/providers/native-agent-shared.js", () => ({
  callClaudeAgent,
  callCodexAgent,
  callScoutWithAgent,
}));

vi.mock("../../evals/providers/qwen-scout-shared.js", () => ({
  callQwenScout,
}));

vi.mock("../../evals/scripts/prepare-workspace.js", () => ({
  getStagedAgentWorkspace: () => "/tmp/staged-agent-workspace",
  getStagedEditWorkspace: () => "/tmp/staged-edit-workspace",
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

  it("normalizes PROXY_API and PROXY_TOKEN into provider env defaults", async () => {
    process.env = {
      ...originalEnv,
      PROXY_API: "http://localhost:8317/v1",
      PROXY_TOKEN: "proxy-token",
      OPENAI_API_KEY: "existing-openai-token",
      ANTHROPIC_API_KEY: "existing-anthropic-token",
    };

    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/load-local-env.js");
    mod.loadLocalEnv();

    expect(process.env.OPENAI_BASE_URL).toBe("http://localhost:8317/v1");
    expect(process.env.ANTHROPIC_BASE_URL).toBe("http://localhost:8317");
    expect(process.env.PROXY_API_KEY).toBe("proxy-token");
    expect(process.env.OPENAI_API_KEY).toBe("proxy-token");
    expect(process.env.ANTHROPIC_API_KEY).toBe("proxy-token");
    expect(process.env.OPENAI_AGENT_EVAL_MODEL).toBe("gpt-5-codex-mini");
    expect(process.env.ANTHROPIC_AGENT_EVAL_MODEL).toBe("claude-haiku-4-5-20251001");
  });

  it("preserves OPENROUTER_API_KEY precedence over OPENROUTER_KEY for scout runs", async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: "existing-openrouter-token",
      OPENROUTER_KEY: "openrouter-token",
    };

    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/load-local-env.js");
    mod.loadLocalEnv();

    expect(process.env.OPENROUTER_API_KEY).toBe("existing-openrouter-token");
  });

  it("routes the Claude default-tools provider through the SDK-native agent path", async () => {
    callClaudeAgent.mockResolvedValue({ output: "ok" });
    // @ts-expect-error test-only import of JS eval provider outside src/
    const mod = await import("../../evals/providers/anthropic-default-tools.js");
    const provider = new mod.default();

    await provider.callApi("question", { vars: { semantic: true } });

    expect(callClaudeAgent).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({
        workspaceRoot: "/tmp/staged-agent-workspace",
        useMcp: false,
        semantic: true,
        tier: "base",
      })
    );
    expect(provider.id()).toContain("anthropic-");
    expect(provider.id()).toContain(process.env.ANTHROPIC_AGENT_EVAL_MODEL ?? "claude-haiku-4-5-20251001");
  });

  it("routes the Codex FreeContext provider through the SDK-native agent path", async () => {
    callCodexAgent.mockResolvedValue({ output: "ok" });
    // @ts-expect-error test-only import of JS eval provider outside src/
    const mod = await import("../../evals/providers/openai-freecontext.js");
    const provider = new mod.default();

    await provider.callApi("question", { vars: { endpoint: "http://127.0.0.1:3214/mcp", semantic: true } });

    expect(callCodexAgent).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({
        workspaceRoot: "/tmp/staged-agent-workspace",
        useMcp: true,
        semantic: true,
        endpoint: "http://127.0.0.1:3214/mcp",
        tier: "freecontext",
      })
    );
    expect(provider.id()).toContain("openai-");
    expect(provider.id()).toContain(process.env.OPENAI_AGENT_EVAL_MODEL ?? "gpt-5-codex-mini");
  });

  it("routes scout rows through the current SDK-native scout handoff", async () => {
    callScoutWithAgent.mockResolvedValue({ output: "ok" });
    callQwenScout.mockResolvedValue({ output: "scout" });
    // @ts-expect-error test-only import of JS eval provider outside src/
    const mod = await import("../../evals/providers/scout-provider.js");
    const provider = new mod.default({ config: { mainProvider: "anthropic", scoutModel: "qwen/qwen3.5-27b" } });

    await provider.callApi("question", { vars: { endpoint: "http://127.0.0.1:3214/mcp", semantic: true } });

    expect(callScoutWithAgent).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({
        scoutModel: "qwen/qwen3.5-27b",
        semantic: true,
      })
    );
  });

  it("resolves scout presets for additional scout models", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/providers/scout-models.js");

    expect(mod.resolveScoutRuntime({ preset: "minimax-2.5" }).model).toBe("minimax/minimax-m2.5");
    expect(mod.resolveScoutRuntime({ preset: "stepfun-3.5-flash" }).model).toBe("stepfun/step-3.5-flash");
    expect(mod.resolveScoutRuntime({ preset: "grok-4.1-fast" }).model).toBe("x-ai/grok-4.1-fast");
    expect(mod.resolveScoutRuntime({ preset: "nemotron-super" }).model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(mod.resolveScoutRuntime({ preset: "openai-compatible" }).baseUrl).toContain("/v1");
  });

  it("routes scout default-tools rows without FreeContext MCP", async () => {
    callScoutWithAgent.mockResolvedValue({ output: "ok" });
    callQwenScout.mockResolvedValue({ output: "scout" });
    // @ts-expect-error test-only import of JS eval provider outside src/
    const mod = await import("../../evals/providers/scout-provider.js");
    const provider = new mod.default({
      config: {
        mainProvider: "anthropic",
        scoutModel: "qwen/qwen3.5-27b",
        useMcp: false,
      },
    });

    await provider.callApi("question", { vars: { endpoint: "http://127.0.0.1:3214/mcp", semantic: false } });

    expect(callScoutWithAgent).toHaveBeenCalledWith(
      "question",
      expect.objectContaining({
        scoutModel: "qwen/qwen3.5-27b",
        useMcp: false,
        tier: "scout-base",
      })
    );
  });

  it("filters the agent config down to one exact OpenAI base row", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/promptfoo-provider-filter.js");
    const rendered = mod.buildFilteredPromptfooConfig(
      "evals/agent-evals.yaml",
      "^openai-gpt-5-codex-mini-default-tools$"
    );

    expect(rendered).toContain('label: "openai-gpt-5-codex-mini-default-tools"');
    expect(rendered).not.toContain('label: "openai-gpt-5-codex-mini-default-tools+freecontext"');
    expect(rendered).not.toContain('label: "anthropic-claude-haiku-4-5-20251001-default-tools"');
  });

  it("filters the scout matrix config down to one exact scout row", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/promptfoo-provider-filter.js");
    const rendered = mod.buildFilteredPromptfooConfig(
      "evals/agent-scout-matrix-evals.yaml",
      "^anthropic-claude-haiku-4-5-20251001-scout-qwen-qwen3.5-27b-default-tools\\+freecontext$"
    );

    expect(rendered).toContain(
      'label: "anthropic-claude-haiku-4-5-20251001-scout-qwen-qwen3.5-27b-default-tools+freecontext"'
    );
    expect(rendered).not.toContain('label: "anthropic-claude-haiku-4-5-20251001-default-tools+freecontext"');
    expect(rendered).not.toContain('label: "openai-gpt-5-codex-mini-default-tools+freecontext"');
  });

  it("adds model-derived labels when rendering the edit config", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/promptfoo-provider-filter.js");
    const rendered = mod.buildFilteredPromptfooConfig("evals/edit-evals.yaml", null);

    expect(rendered).toContain('label: "anthropic-claude-haiku-4-5-20251001-default-tools-edit"');
    expect(rendered).toContain('label: "openai-gpt-5-codex-mini-default-tools+freecontext-edit"');
    expect(rendered).toContain(
      'label: "anthropic-claude-haiku-4-5-20251001-scout-qwen-qwen3.5-27b-default-tools+freecontext-edit"'
    );
  });

  it("starts semantic evals with a remote openai-compatible embedding backend when configured", async () => {
    process.env.FREE_CONTEXT_EMBED_BASE_URL = "http://192.168.1.117:8002/v1";
    process.env.FREE_CONTEXT_EMBED_MODEL_ID = "qwen3-embedding-0.6b";
    process.env.FREE_CONTEXT_EMBED_DIMENSIONS = "1024";
    startManagedServerWithOptions.mockResolvedValue({
      endpoint: "http://127.0.0.1:3213/mcp",
      workspaceRoot: "/tmp/staged-agent-workspace",
    });
    // @ts-expect-error test-only import of JS eval hook outside src/
    const mod = await import("../../evals/scripts/semantic-hooks.js");

    await mod.semanticEvalHook("beforeAll", {});

    expect(startManagedServerWithOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        embed: true,
        extraArgs: [
          "--embedder",
          "openai_compatible",
          "--embedding-base-url",
          "http://192.168.1.117:8002/v1",
          "--embedding-model-id",
          "qwen3-embedding-0.6b",
          "--embedding-dimensions",
          "1024",
        ],
      })
    );
    expect(process.env.FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT).toBe("http://127.0.0.1:3213/mcp");
  });
});
