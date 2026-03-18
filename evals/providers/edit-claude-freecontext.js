import { getStagedEditWorkspace } from "../scripts/prepare-workspace.js";
import { callClaudeAgent } from "./native-agent-shared.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildMainAgentLabel } from "./provider-labels.js";

export default class EditClaudeFreeContextProvider {
  id() {
    return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: true, taskType: "edit" });
  }

  async callApi(prompt, context) {
    return withEvalTrace(buildEvalTraceOptions({
      prompt,
      context,
      metadata: {
        providerLabel: this.id(),
        providerFamily: "anthropic",
        tier: "freecontext",
        taskType: "edit",
      },
    }), (traceSpan) => callClaudeAgent(prompt, {
      workspaceRoot: getStagedEditWorkspace(),
      useMcp: true,
      endpoint: context.vars?.endpoint,
      tier: "freecontext",
      traceSpan,
    }));
  }
}
