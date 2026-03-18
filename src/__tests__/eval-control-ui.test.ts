import { describe, expect, it } from "vitest";

describe("eval control UI shared helpers", () => {
  it("routes OpenAI and Anthropic through proxy settings when proxy mode is selected", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/eval-control-shared.js");
    const env = mod.buildEvalControlEnv({
      openai: {
        route: "proxy",
        model: "gpt-5-codex-mini",
        proxyUrl: "http://localhost:8317/v1",
        proxyToken: "proxy-openai",
      },
      anthropic: {
        route: "proxy",
        model: "claude-haiku-4-5-20251001",
        proxyUrl: "http://localhost:8317/v1",
        proxyToken: "proxy-anthropic",
      },
    }, {});

    expect(env.OPENAI_BASE_URL).toBe("http://localhost:8317/v1");
    expect(env.OPENAI_API_KEY).toBe("proxy-openai");
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:8317");
    expect(env.ANTHROPIC_API_KEY).toBe("proxy-anthropic");
  });

  it("loads direct provider defaults from dedicated env variables when present", async () => {
    const original = {
      OPENAI_DIRECT_BASE_URL: process.env.OPENAI_DIRECT_BASE_URL,
      OPENAI_DIRECT_API_KEY: process.env.OPENAI_DIRECT_API_KEY,
      ANTHROPIC_DIRECT_BASE_URL: process.env.ANTHROPIC_DIRECT_BASE_URL,
      ANTHROPIC_DIRECT_API_KEY: process.env.ANTHROPIC_DIRECT_API_KEY,
    };

    process.env.OPENAI_DIRECT_BASE_URL = "https://api.openai.com/v1";
    process.env.OPENAI_DIRECT_API_KEY = "openai-direct";
    process.env.ANTHROPIC_DIRECT_BASE_URL = "https://api.anthropic.com";
    process.env.ANTHROPIC_DIRECT_API_KEY = "anthropic-direct";

    try {
      // @ts-expect-error test-only import of JS eval helper outside src/
      const mod = await import("../../evals/scripts/eval-control-shared.js?envdefaults");
      const config = mod.defaultEvalControlConfig();

      expect(config.openai.directBaseUrl).toBe("https://api.openai.com/v1");
      expect(config.openai.directApiKey).toBe("openai-direct");
      expect(config.anthropic.directBaseUrl).toBe("https://api.anthropic.com");
      expect(config.anthropic.directApiKey).toBe("anthropic-direct");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("routes scout through an openai-compatible local endpoint when selected", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/eval-control-shared.js");
    const env = mod.buildEvalControlEnv({
      scout: {
        source: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "llama3.3",
        localApiKey: "ollama",
      },
    }, {});

    expect(env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL).toBe("http://127.0.0.1:11434/v1");
    expect(env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL).toBe("llama3.3");
    expect(env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY).toBe("ollama");
  });

  it("builds model-derived labels for the active main agent rows", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/eval-control-shared.js");
    const labels = mod.availableEvalLabels({
      anthropic: { model: "claude-haiku-4-5-20251001" },
      openai: { model: "gpt-5-codex-mini" },
      scout: { source: "openrouter", preset: "qwen-27b" },
    });

    expect(labels.agent).toContain("anthropic-claude-haiku-4-5-20251001-default-tools");
    expect(labels.agent).toContain("openai-gpt-5-codex-mini-default-tools");
    expect(labels.agent).toContain(
      "openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools+freecontext"
    );
    expect(labels.matrix.anthropic.defaultTools).toBe(
      "anthropic-claude-haiku-4-5-20251001-default-tools"
    );
    expect(labels.matrix.openai.defaultToolsFreecontext).toBe(
      "openai-gpt-5-codex-mini-default-tools+freecontext"
    );
  });

  it("maps legacy and new retrieval suite names to the right runner scripts", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/eval-control-shared.js");

    expect(mod.normalizeEvalSuiteName("semantic")).toBe("tool-embedding");
    expect(mod.normalizeEvalSuiteName("semantic-smoke")).toBe("tool-embedding-smoke");
    expect(mod.normalizeEvalSuiteName("agent-semantic")).toBe("agent-embedding");
    expect(mod.normalizeEvalSuiteName("agent-semantic-smoke")).toBe("agent-embedding-smoke");
    expect(mod.suiteScriptName("agent-embedding")).toBe("run-agent-embedding-evals.js");
    expect(mod.suiteScriptName("agent-hybrid")).toBe("run-agent-hybrid-evals.js");
    expect(mod.suiteScriptName("tool-fulltext")).toBe("run-tool-fulltext-evals.js");
    expect(mod.suiteScriptName("tool-embedding")).toBe("run-tool-embedding-evals.js");
    expect(mod.suiteScriptName("tool-hybrid")).toBe("run-tool-hybrid-evals.js");
    expect(mod.suiteScriptName("tool-embed-health")).toBe("run-tool-embed-smoke.js");
  });
});
