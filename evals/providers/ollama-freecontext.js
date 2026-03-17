import { callOllamaWithFreeContext } from "./ollama-shared.js";

export default class OllamaFreeContextProvider {
  id() {
    return "ollama-freecontext";
  }

  async callApi(prompt, context) {
    const endpoint = context.vars?.endpoint;
    return callOllamaWithFreeContext(prompt, endpoint);
  }
}
