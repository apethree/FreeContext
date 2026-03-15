import { readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { glob } from "glob";
import type { FileProvider } from "../types/index.js";

export class NodeFileProvider implements FileProvider {
  async listFiles(root: string, extensions?: string[]): Promise<string[]> {
    const exts = extensions ?? [".ts", ".tsx", ".js", ".jsx"];
    const pattern = `**/*{${exts.join(",")}}`;
    const files = await glob(pattern, {
      cwd: root,
      absolute: false,
      ignore: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/build/**",
        "**/coverage/**",
        "**/.next/**",
      ],
    });
    return files.map((f) => f.replace(/\\/g, "/"));
  }

  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, "utf-8");
  }

  async stat(filePath: string): Promise<{ mtimeMs: number } | null> {
    try {
      const s = await stat(filePath);
      return { mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }
}
