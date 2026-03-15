import { describe, it, expect } from "vitest";
import { CodeIntelEngine } from "../core/engine.js";
import { resolve } from "node:path";

describe("CodeIntelEngine", () => {
  it("creates with default config", () => {
    const engine = new CodeIntelEngine({ rootPath: "/tmp/test" });
    expect(engine.config.rootPath).toBe("/tmp/test");
    expect(engine.config.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
    expect(engine.config.storage).toBe("memory");
    expect(engine.config.embed).toBe(false);
  });

  it("indexes own source files", async () => {
    const rootPath = resolve(import.meta.dirname, "../..");
    const engine = new CodeIntelEngine({ rootPath });
    const result = await engine.index();
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(result.symbolsIndexed).toBeGreaterThan(0);
  });

  it("searches after indexing", async () => {
    const rootPath = resolve(import.meta.dirname, "../..");
    const engine = new CodeIntelEngine({ rootPath });
    await engine.index();
    const results = await engine.searchSymbols("CodeIntelEngine");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((s) => s.symbolName === "CodeIntelEngine")).toBe(true);
  });
});
