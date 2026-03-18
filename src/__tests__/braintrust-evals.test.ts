import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("braintrust eval helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads agent cases from the promptfoo yaml with expected targets and deterministic checks", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/braintrust-case-loader.js");
    const loaded = await mod.loadBraintrustCases("evals/agent-evals.yaml", {
      filterPattern: "trace plugin dispatch callers",
    });

    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0].expected).toContain("dispatchPlugin");
    expect(loaded.cases[0].metadata.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-contract" }),
        expect.objectContaining({ type: "contains", value: "dispatchPlugin" }),
      ])
    );
  });

  it("lists the active three-tier agent variants per provider family", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-token";
    process.env.OPENAI_API_KEY = "openai-token";
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/agent-variant-matrix.js");
    const variants = mod.listActiveAgentVariants({ group: "all" });
    const labels = variants.map((variant: { label: string }) => variant.label);

    expect(variants).toHaveLength(6);
    expect(labels.some((label: string) => label.includes("default-tools+freecontext"))).toBe(true);
    expect(labels.some((label: string) => label.includes("scout-qwen-qwen3.5-27b-default-tools+freecontext"))).toBe(true);
    expect(labels.some((label: string) => label.endsWith("scout-qwen-qwen3.5-27b-default-tools"))).toBe(false);
    expect(variants.some((variant: { strategy: string }) => variant.strategy === "baseline")).toBe(true);
    expect(variants.some((variant: { strategy: string }) => variant.strategy === "direct-freecontext")).toBe(true);
    expect(variants.some((variant: { strategy: string }) => variant.strategy === "scout-bridge-freecontext")).toBe(true);
    expect(
      variants.some(
        (variant: { strategyLabel?: string; variantDisplayName?: string }) =>
          variant.strategyLabel === "Direct FreeContext" &&
          variant.variantDisplayName?.includes("OpenAI | gpt-5-codex-mini | Direct FreeContext")
      )
    ).toBe(true);
  });

  it("scores deterministic contains and tool-contract checks", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/braintrust-scorers.js");
    const scores = mod.strictDeterministicScorer({
      output: "apps/gateway/src/channels/plugin-registry.ts dispatchPlugin",
      metadata: {
        tier: "freecontext",
        localToolCount: 2,
        mcpToolCount: 1,
        checks: [
          { type: "tool-contract" },
          { type: "contains", value: "dispatchPlugin" },
        ],
      },
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "FinalAnswerStrictPass", score: 1 }),
        expect.objectContaining({ name: "FinalAnswerStrictFraction", score: 1 }),
      ])
    );
  });

  it("returns a partial deterministic score with failure metadata when checks are missing", async () => {
    // @ts-expect-error test-only import of JS eval helper outside src/
    const mod = await import("../../evals/scripts/braintrust-scorers.js");
    const scores = mod.strictDeterministicScorer({
      output: "apps/gateway/src/api/client-routes.ts",
      metadata: {
        tier: "base",
        localToolCount: 1,
        mcpToolCount: 0,
        checks: [
          { type: "tool-contract" },
          { type: "contains", value: "dispatchPlugin" },
        ],
      },
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "FinalAnswerStrictPass", score: 0 }),
        expect.objectContaining({
          name: "FinalAnswerStrictFraction",
          score: 0.5,
          metadata: expect.objectContaining({
            failures: expect.arrayContaining(["missing:dispatchPlugin"]),
          }),
        }),
      ])
    );
  });
});
