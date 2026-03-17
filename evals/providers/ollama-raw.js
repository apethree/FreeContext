import { callOllamaRaw } from "./ollama-shared.js";

export default class OllamaRawProvider {
  id() {
    return "ollama-raw";
  }

  async callApi(prompt) {
    return callOllamaRaw(prompt);
  }
}
