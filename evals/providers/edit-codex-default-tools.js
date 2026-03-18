import { getStagedEditWorkspace } from "../scripts/prepare-workspace.js";
import { callCodexAgent } from "./native-agent-shared.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildMainAgentLabel } from "./provider-labels.js";

export default class EditCodexDefaultToolsProvider {
  id() {
    return buildMainAgentLabel({ mainProvider: "openai", useMcp: false, taskType: "edit" });
  }

  async callApi(prompt, context) {
    return withEvalTrace(buildEvalTraceOptions({
      prompt,
      context,
      metadata: {
        providerLabel: this.id(),
        providerFamily: "openai",
        tier: "base",
        taskType: "edit",
      },
    }), (traceSpan) => callCodexAgent(prompt, {
      workspaceRoot: getStagedEditWorkspace(),
      useMcp: false,
      tier: "base",
      traceSpan,
    }));
  }
}
