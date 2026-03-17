import { callAnthropicWithFreeContext } from "./agent-shared.js";

export default class AnthropicFreeContextProvider {
  id() {
    return "anthropic-freecontext";
  }

  async callApi(prompt, context) {
    return callAnthropicWithFreeContext(
      prompt,
      context.vars?.endpoint
    );
  }
}
