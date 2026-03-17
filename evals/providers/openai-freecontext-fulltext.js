import { callOpenAiWithFreeContext } from "./agent-shared.js";

export default class OpenAiFreeContextFulltextProvider {
  id() {
    return "openai-freecontext-fulltext";
  }

  async callApi(prompt) {
    const endpoint =
      process.env.FREE_CONTEXT_FULLTEXT_MCP_ENDPOINT ??
      process.env.FREE_CONTEXT_EVAL_MCP_ENDPOINT ??
      "http://127.0.0.1:3214/mcp";

    return callOpenAiWithFreeContext(prompt, endpoint);
  }
}
