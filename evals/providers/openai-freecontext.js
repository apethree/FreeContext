import { callOpenAiWithFreeContext } from "./agent-shared.js";

export default class OpenAiFreeContextProvider {
  id() {
    return "openai-freecontext";
  }

  async callApi(prompt, context) {
    return callOpenAiWithFreeContext(
      prompt,
      context.vars?.endpoint
    );
  }
}
