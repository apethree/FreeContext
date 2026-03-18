import { readFile, stat } from "node:fs/promises";
import { glob } from "glob";
import type { FileProvider } from "../types/index.js";

export class NodeFileProvider implements FileProvider {
  async listFiles(
    root: string,
    extensions?: string[],
    ignore?: string[]
  ): Promise<string[]> {
    const exts = extensions ?? [".ts", ".tsx", ".js", ".jsx"];
    const ignorePatterns = this.buildIgnorePatterns(ignore);
    const extPattern = exts.map((ext) => ext.replace(/^\./, ""));
    const pattern =
      extPattern.length === 1
        ? `**/*.${extPattern[0]}`
        : `**/*.{${extPattern.join(",")}}`;
    const files = await glob(pattern, {
      cwd: root,
      absolute: false,
      ignore: ignorePatterns,
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

  private buildIgnorePatterns(ignore?: string[]): string[] {
    const entries = ignore ?? [
      "node_modules",
      "dist",
      "evals/workspaces",
      ".git",
      "build",
      "coverage",
      ".next",
    ];

    return entries.flatMap((entry) => {
      const normalized = entry.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
      if (normalized.length === 0) {
        return [];
      }

      if (/[*?[\]{}]/.test(normalized)) {
        return [normalized];
      }

      return [
        normalized,
        `${normalized}/**`,
        `**/${normalized}`,
        `**/${normalized}/**`,
      ];
    });
  }
}
