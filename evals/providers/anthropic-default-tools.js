import { getStagedAgentWorkspace } from "../scripts/prepare-workspace.js";
import { callClaudeAgent } from "./native-agent-shared.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildMainAgentLabel } from "./provider-labels.js";

export default class AnthropicDefaultToolsProvider {
  id() {
    return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: false });
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
        providerFamily: "anthropic",
        tier: "base",
        taskType: "agent",
      },
    }), (traceSpan) => callClaudeAgent(prompt, {
      workspaceRoot: getStagedAgentWorkspace(),
      useMcp: false,
      semantic: retrievalMode !== "fulltext",
      retrievalMode,
      tier: "base",
      phaseName: "main_phase",
      traceSpan,
    }));
  }
}
