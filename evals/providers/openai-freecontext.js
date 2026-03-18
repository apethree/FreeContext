import { getStagedAgentWorkspace } from "../scripts/prepare-workspace.js";
import { callCodexAgent } from "./native-agent-shared.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildMainAgentLabel } from "./provider-labels.js";

export default class OpenAiFreeContextProvider {
  id() {
    return buildMainAgentLabel({ mainProvider: "openai", useMcp: true });
  }

  async callApi(prompt, context) {
    const retrievalMode = context?.vars?.retrievalMode === "embedding" || context?.vars?.retrievalMode === "hybrid"
      ? context.vars.retrievalMode
      : context?.vars?.semantic === true
        ? "embedding"
        : "fulltext";
    return withEvalTrace(buildEvalTraceOptions({
      prompt,
      context,
      metadata: {
        providerLabel: this.id(),
        providerFamily: "openai",
        tier: "freecontext",
        taskType: "agent",
      },
    }), (traceSpan) => callCodexAgent(prompt, {
      workspaceRoot: getStagedAgentWorkspace(),
      useMcp: true,
      semantic: retrievalMode !== "fulltext",
      retrievalMode,
      endpoint: context.vars?.endpoint,
      tier: "freecontext",
      phaseName: "main_phase",
      traceSpan,
    }));
  }
}
