import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectConfig } from "../core/config-loader.js";

const createdDirs: string[] = [];

describe("loadProjectConfig", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns an empty object when the config file is missing", async () => {
    const rootPath = await makeTempDir();

    await expect(loadProjectConfig(rootPath)).resolves.toEqual({});
  });

  it("loads and resolves a valid project config", async () => {
    const rootPath = await makeTempDir();
    await writeFile(
      join(rootPath, ".free-context.json"),
      JSON.stringify({
        storage: "lancedb",
        storagePath: ".free-context/db",
        embed: true,
        embedder: "ollama",
        embeddingBaseUrl: "http://127.0.0.1:11434",
        embeddingDimensions: 1024,
        ignore: ["fixtures"],
      })
    );

    const config = await loadProjectConfig(rootPath);

    expect(config.storage).toBe("lancedb");
    expect(config.storagePath).toBe(join(rootPath, ".free-context/db"));
    expect(config.embed).toBe(true);
    expect(config.embedder).toBe("ollama");
    expect(config.embeddingBaseUrl).toBe("http://127.0.0.1:11434");
    expect(config.embeddingDimensions).toBe(1024);
    expect(config.ignore).toEqual(["fixtures"]);
  });

  it("throws on invalid project config", async () => {
    const rootPath = await makeTempDir();
    await writeFile(
      join(rootPath, ".free-context.json"),
      JSON.stringify({
        storage: "sqlite",
      })
    );

    await expect(loadProjectConfig(rootPath)).rejects.toThrow();
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "free-context-config-"));
  createdDirs.push(dir);
  return dir;
}
