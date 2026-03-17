import { callOpenAiRaw } from "./agent-shared.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export default class OpenRouterRawProvider {
  constructor(options = {}) {
    this._model = options.model ?? "qwen/qwen3.5-27b";
  }

  id() {
    return `openrouter-raw-${this._model.replace(/[/:]/g, "-")}`;
  }

  async callApi(prompt, context) {
    const model = context?.vars?.model ?? this._model;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENROUTER_API_KEY");
    }

    return callOpenAiRaw(prompt, {
      apiUrl: OPENROUTER_API_URL,
      model,
      apiKey,
      providerLabel: `OpenRouter:${model}`,
    });
  }
}
