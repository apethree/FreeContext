import type { Embedder, EmbeddingProgress } from "../types/index.js";

export interface RemoteEmbedderOptions {
  modelId: string;
  dimensions?: number;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  apiPath?: string;
  apiKeyOptional?: boolean;
  batchSize?: number;
}

interface EmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
  }>;
}

interface BatchResult {
  embeddings: number[][];
  requests: number;
}

export class RemoteEmbedder implements Embedder {
  readonly modelId: string;
  get dimensions(): number {
    return this._dimensions;
  }

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiKeyEnvVar?: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly apiPath: string;
  private readonly apiKeyOptional: boolean;
  private readonly batchSize: number;
  private _dimensions: number;

  constructor(options: RemoteEmbedderOptions) {
    this.modelId = options.modelId;
    this._dimensions = options.dimensions ?? 0;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiKeyEnvVar = options.apiKeyEnvVar;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiPath = options.apiPath ?? "/embeddings";
    this.apiKeyOptional = options.apiKeyOptional ?? false;
    this.batchSize = options.batchSize ?? 128;
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

    const apiKey = this.apiKey ?? (this.apiKeyEnvVar ? process.env[this.apiKeyEnvVar] : undefined);
    if (!apiKey && !this.apiKeyOptional) {
      throw new Error(
        `Missing API key for embedder ${this.modelId}. Expected ${this.apiKeyEnvVar ?? "configured apiKey"}.`
      );
    }

    const allVectors: number[][] = [];
    const plannedBatches = Math.ceil(texts.length / this.batchSize);
    let requestsCompleted = 0;

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const result = await this.embedBatch(batch, apiKey);
      const embeddings = result.embeddings;
      requestsCompleted += result.requests;

      if (embeddings[0]?.length && this._dimensions === 0) {
        this._dimensions = embeddings[0].length;
      }

      allVectors.push(...embeddings);
      options?.onProgress?.({
        stage: "embed",
        batchIndex: Math.floor(offset / this.batchSize) + 1,
        totalBatches: plannedBatches,
        completedTexts: allVectors.length,
        totalTexts: texts.length,
        message: `embedded ${allVectors.length}/${texts.length} texts via ${this.modelId} (${requestsCompleted} requests)`,
      });
    }

    return allVectors;
  }

  private async embedBatch(texts: string[], apiKey?: string): Promise<BatchResult> {
    const response = await this.fetchImpl(`${this.baseUrl}${this.apiPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...this.headers,
      },
      body: JSON.stringify({
        model: this.modelId,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (shouldSplitBatch(response.status, body, texts.length)) {
        const midpoint = Math.ceil(texts.length / 2);
        const left = await this.embedBatch(texts.slice(0, midpoint), apiKey);
        const right = await this.embedBatch(texts.slice(midpoint), apiKey);
        return {
          embeddings: [...left.embeddings, ...right.embeddings],
          requests: left.requests + right.requests,
        };
      }

      throw new Error(`Embedding request failed for ${this.modelId}: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as EmbeddingsResponse;
    const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? [];

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding provider ${this.modelId} returned ${embeddings.length} vectors for ${texts.length} texts.`
      );
    }

    return {
      embeddings,
      requests: 1,
    };
  }
}

function shouldSplitBatch(status: number, body: string, batchSize: number): boolean {
  if (batchSize <= 1) {
    return false;
  }

  if (status === 413 || status === 429) {
    return true;
  }

  if (status >= 500) {
    const lower = body.toLowerCase();
    return (
      lower.includes("too large") ||
      lower.includes("too many tokens") ||
      lower.includes("max tokens") ||
      lower.includes("context length") ||
      lower.includes("batch size")
    );
  }

  return false;
}
