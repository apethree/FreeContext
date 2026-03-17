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

  it("defaults --embed style configs to ollama", () => {
    const engine = new CodeIntelEngine({ rootPath: "/tmp/test", embed: true });

    expect(engine.config.embedder).toBe("ollama");
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

  it("filters symbols by file path", async () => {
    const rootPath = resolve(import.meta.dirname, "../..");
    const engine = new CodeIntelEngine({ rootPath });
    await engine.index();
    const results = await engine.querySymbols({ filePath: "src/core/engine.ts" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) => s.filePath === "src/core/engine.ts")).toBe(true);
  });

  it("filters symbols by kind", async () => {
    const rootPath = resolve(import.meta.dirname, "../..");
    const engine = new CodeIntelEngine({ rootPath });
    await engine.index();
    const results = await engine.querySymbols({
      text: "CodeIntelEngine",
      symbolKind: "class",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) => s.symbolKind === "class")).toBe(true);
  });

  it("searches indexed file paths", async () => {
    const rootPath = resolve(import.meta.dirname, "../..");
    const engine = new CodeIntelEngine({ rootPath });
    await engine.index();
    const results = await engine.searchPaths("core", 20, "src/");
    expect(results.some((filePath) => filePath === "src/core/engine.ts")).toBe(true);
    expect(results.every((filePath) => filePath.startsWith("src/"))).toBe(true);
  });
});
