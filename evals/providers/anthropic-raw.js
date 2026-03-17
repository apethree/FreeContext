import { callAnthropicRaw } from "./agent-shared.js";

export default class AnthropicRawProvider {
  id() {
    return "anthropic-raw";
  }

  async callApi(prompt) {
    return callAnthropicRaw(prompt);
  }
}
