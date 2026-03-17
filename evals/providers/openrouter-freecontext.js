import { callOpenAiWithFreeContext } from "./agent-shared.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export default class OpenRouterFreeContextProvider {
  constructor(options = {}) {
    this._model = options.model ?? "qwen/qwen3.5-27b";
  }

  id() {
    return `openrouter-freecontext-${this._model.replace(/[/:]/g, "-")}`;
  }

  async callApi(prompt, context) {
    const model = context?.vars?.model ?? this._model;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENROUTER_API_KEY");
    }

    return callOpenAiWithFreeContext(prompt, context?.vars?.endpoint, {
      apiUrl: OPENROUTER_API_URL,
      model,
      apiKey,
    });
  }
}
