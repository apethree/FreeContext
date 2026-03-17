import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CodeIntelConfig } from "../types/index.js";

const projectConfigSchema = z
  .object({
    repoId: z.string().min(1).optional(),
    extensions: z.array(z.string().min(1)).optional(),
    ignore: z.array(z.string().min(1)).optional(),
    storage: z.enum(["memory", "lancedb"]).optional(),
    storagePath: z.string().min(1).optional(),
    embed: z.boolean().optional(),
    embedder: z
      .enum([
        "none",
        "ollama",
        "openai_compatible",
        "nvidia_nemotron",
        "step_3_5_flash",
        "minimax_2_5",
      ])
      .optional(),
    embeddingModelId: z.string().min(1).optional(),
    embeddingBaseUrl: z.string().url().optional(),
    embeddingDimensions: z.number().int().positive().optional(),
  })
  .strict();

export async function loadProjectConfig(rootPath: string): Promise<Partial<CodeIntelConfig>> {
  const configPath = join(rootPath, ".free-context.json");

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = projectConfigSchema.parse(JSON.parse(raw));

    return {
      ...parsed,
      storagePath: parsed.storagePath ? resolve(rootPath, parsed.storagePath) : undefined,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}
