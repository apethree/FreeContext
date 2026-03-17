import { RemoteEmbedder } from "./remote-embedder.js";

export const DEFAULT_NVIDIA_EMBEDDING_MODEL = "nvidia/llama-nemotron-embed-1b-v2";
export const DEFAULT_STEP_EMBEDDING_MODEL = "step-3.5-flash";
export const DEFAULT_MINIMAX_EMBEDDING_MODEL = "MiniMax-M2.5";

export class NvidiaNemotronEmbedder extends RemoteEmbedder {
  constructor(modelId = DEFAULT_NVIDIA_EMBEDDING_MODEL) {
    super({
      modelId,
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKeyEnvVar: "NVIDIA_API_KEY",
    });
  }
}

export class StepFlashEmbedder extends RemoteEmbedder {
  constructor(modelId = DEFAULT_STEP_EMBEDDING_MODEL) {
    super({
      modelId,
      baseUrl: "https://api.stepfun.com/v1",
      apiKeyEnvVar: "STEP_API_KEY",
    });
  }
}

export class MinimaxEmbedder extends RemoteEmbedder {
  constructor(modelId = DEFAULT_MINIMAX_EMBEDDING_MODEL) {
    super({
      modelId,
      baseUrl: "https://api.minimax.io/v1",
      apiKeyEnvVar: "MINIMAX_API_KEY",
    });
  }
}
