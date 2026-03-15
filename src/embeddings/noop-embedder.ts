import type { Embedder } from "../types/index.js";

export class NoopEmbedder implements Embedder {
  readonly modelId = "noop";
  readonly dimensions = 0;

  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}
