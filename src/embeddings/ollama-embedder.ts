import type { Embedder, EmbeddingProgress } from "../types/index.js";

export const OLLAMA_EMBEDDING_DEFAULTS = {
  model: "qwen3-embedding:0.6b",
  host: "http://127.0.0.1:11434",
  dimensions: 1024,
  batchSize: 256,
} as const;

interface OllamaEmbedderOptions {
  model?: string;
  host?: string;
  dimensions?: number;
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

export class OllamaEmbedder implements Embedder {
  readonly modelId: string;
  get dimensions(): number {
    return this._dimensions;
  }

  private readonly host: string;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private _dimensions: number;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.modelId =
      options.model ??
      process.env.OLLAMA_EMBEDDING_MODEL ??
      OLLAMA_EMBEDDING_DEFAULTS.model;
    this.host =
      (options.host ?? process.env.OLLAMA_HOST ?? OLLAMA_EMBEDDING_DEFAULTS.host).replace(/\/+$/, "");
    // Start at 0 so LanceDB infers column width from actual response — updated after first batch.
    // Pass an explicit dimensions option to pin a known width upfront (e.g. for pre-existing DBs).
    this._dimensions = options.dimensions ?? 0;
    this.batchSize = options.batchSize ?? OLLAMA_EMBEDDING_DEFAULTS.batchSize;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedTexts(
    texts: string[],
    options?: {
      onProgress?: (progress: EmbeddingProgress) => void;
    }
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allVectors: number[][] = [];
    const totalBatches = Math.ceil(texts.length / this.batchSize);

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const response = await this.fetchImpl(`${this.host}/api/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelId,
          input: batch,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embed error for ${this.modelId}: ${response.status} ${await response.text()}`);
      }

      const json = (await response.json()) as OllamaEmbedResponse;
      const vectors = json.embeddings ?? [];
      if (vectors.length !== batch.length) {
        throw new Error(
          `Ollama returned ${vectors.length} vectors for ${batch.length} texts with model ${this.modelId}.`
        );
      }

      if (vectors[0]?.length && this._dimensions === 0) {
        this._dimensions = vectors[0].length;
      }
      allVectors.push(...vectors);
      options?.onProgress?.({
        stage: "embed",
        batchIndex: Math.floor(offset / this.batchSize) + 1,
        totalBatches,
        completedTexts: allVectors.length,
        totalTexts: texts.length,
        message: `embedded ${allVectors.length}/${texts.length} texts via ollama`,
      });
    }

    return allVectors;
  }
}
