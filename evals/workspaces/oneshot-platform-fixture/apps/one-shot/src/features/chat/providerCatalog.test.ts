import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG } from "./providerCatalog";

describe("providerCatalog", () => {
  const openaiModelIds = PROVIDER_CATALOG.openai.models.map((m) => m.id);

  it("does not contain unsupported models (gpt-4o, o3, o4-mini)", () => {
    expect(openaiModelIds).not.toContain("gpt-4o");
    expect(openaiModelIds).not.toContain("o3");
    expect(openaiModelIds).not.toContain("o4-mini");
  });

  it("contains Codex-compatible models", () => {
    expect(openaiModelIds).toContain("gpt-5.2");
    expect(openaiModelIds).toContain("gpt-5.2-codex");
    expect(openaiModelIds).toContain("gpt-5.3-codex");
  });

  it("has entries for all expected providers", () => {
    expect(PROVIDER_CATALOG).toHaveProperty("openai");
    expect(PROVIDER_CATALOG).toHaveProperty("anthropic");
    expect(PROVIDER_CATALOG).toHaveProperty("gemini");
  });
});
