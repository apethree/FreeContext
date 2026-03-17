import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileProvider } from "../indexer/node-file-provider.js";

describe("NodeFileProvider", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  async function makeTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "free-context-"));
    tempDirs.push(dir);
    return dir;
  }

  it("lists supported source files by extension", async () => {
    const root = await makeTempProject();
    await writeFile(join(root, "index.ts"), "export const value = 1;\n");
    await writeFile(join(root, "notes.md"), "# ignored\n");

    const provider = new NodeFileProvider();
    const files = await provider.listFiles(root, [".ts"]);

    expect(files).toEqual(["index.ts"]);
  });

  it("applies configured ignore directories", async () => {
    const root = await makeTempProject();
    await mkdir(join(root, "fixtures"), { recursive: true });
    await writeFile(join(root, "index.ts"), "export const value = 1;\n");
    await writeFile(join(root, "fixtures", "ignored.ts"), "export const ignored = true;\n");

    const provider = new NodeFileProvider();
    const files = await provider.listFiles(root, [".ts"], ["fixtures"]);

    expect(files).toEqual(["index.ts"]);
  });

  it("supports glob ignore patterns", async () => {
    const root = await makeTempProject();
    await mkdir(join(root, "generated"), { recursive: true });
    await writeFile(join(root, "keep.ts"), "export const keep = true;\n");
    await writeFile(join(root, "generated", "skip.gen.ts"), "export const skip = true;\n");

    const provider = new NodeFileProvider();
    const files = await provider.listFiles(root, [".ts"], ["**/*.gen.ts"]);

    expect(files).toEqual(["keep.ts"]);
  });
});
