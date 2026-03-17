import { describe, expect, it, vi } from "vitest";
import { OllamaEmbedder, OLLAMA_EMBEDDING_DEFAULTS } from "../embeddings/ollama-embedder.js";
import { RemoteEmbedder } from "../embeddings/remote-embedder.js";
import {
  DEFAULT_MINIMAX_EMBEDDING_MODEL,
  DEFAULT_NVIDIA_EMBEDDING_MODEL,
  DEFAULT_STEP_EMBEDDING_MODEL,
  MinimaxEmbedder,
  NvidiaNemotronEmbedder,
  StepFlashEmbedder,
} from "../embeddings/provider-embedder.js";

describe("embedding backends", () => {
  it("sends remote embedding requests using the OpenAI-compatible format", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
        }),
        { status: 200 }
      )
    );

    const embedder = new RemoteEmbedder({
      modelId: "provider/model",
      baseUrl: "https://example.com/v1",
      apiKey: "secret",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const vectors = await embedder.embedTexts(["a", "b"]);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
          "content-type": "application/json",
        }),
      })
    );
  });

  it("allows OpenAI-compatible local servers without an API key and infers dimensions", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: [1, 0, 0] }],
        }),
        { status: 200 }
      )
    );

    const embedder = new RemoteEmbedder({
      modelId: "local/model",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKeyOptional: true,
      dimensions: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const vectors = await embedder.embedTexts(["hello"]);
    const requestInit = (fetchImpl.mock.calls[0] as unknown[] | undefined)?.[1];

    expect(vectors).toEqual([[1, 0, 0]]);
    expect(embedder.dimensions).toBe(3);
    expect(requestInit).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          authorization: expect.anything(),
        }),
      })
    );
  });

  it("splits oversized OpenAI-compatible batches and retries smaller requests", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
      const inputs = body.input ?? [];
      if (inputs.length > 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "input is too large to process. increase the physical batch size",
            },
          }),
          { status: 500 }
        );
      }
      return new Response(
        JSON.stringify({
          data: [{ embedding: [1, 0] }],
        }),
        { status: 200 }
      );
    });

    const embedder = new RemoteEmbedder({
      modelId: "local/model",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKeyOptional: true,
      dimensions: 2,
      batchSize: 4,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const vectors = await embedder.embedTexts(["a", "b", "c"]);

    expect(vectors).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("calls Ollama's batch embed endpoint and reports batch progress", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          embeddings: [[1, 0], [0, 1]],
        }),
        { status: 200 }
      )
    );
    const onProgress = vi.fn();
    const embedder = new OllamaEmbedder({
      host: "http://127.0.0.1:11434",
      dimensions: 2,
      batchSize: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const vectors = await embedder.embedTexts(["a", "b"], { onProgress });

    expect(vectors).toEqual([[1, 0], [0, 1]]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "embed",
        batchIndex: 1,
        totalBatches: 1,
      })
    );
  });

  it("uses the default Ollama local model and starts dimensions at 0 until first response", () => {
    const embedder = new OllamaEmbedder();

    expect(embedder.modelId).toBe(OLLAMA_EMBEDDING_DEFAULTS.model);
    // Dimensions start at 0 and are updated from the first API response (same pattern as RemoteEmbedder)
    expect(embedder.dimensions).toBe(0);
  });

  it("exposes provider-specific default model ids", () => {
    expect(new NvidiaNemotronEmbedder().modelId).toBe(DEFAULT_NVIDIA_EMBEDDING_MODEL);
    expect(new StepFlashEmbedder().modelId).toBe(DEFAULT_STEP_EMBEDDING_MODEL);
    expect(new MinimaxEmbedder().modelId).toBe(DEFAULT_MINIMAX_EMBEDDING_MODEL);
  });
});
