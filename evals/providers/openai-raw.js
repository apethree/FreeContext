import { callOpenAiRaw } from "./agent-shared.js";

export default class OpenAiRawProvider {
  id() {
    return "openai-raw";
  }

  async callApi(prompt) {
    return callOpenAiRaw(prompt);
  }
}
