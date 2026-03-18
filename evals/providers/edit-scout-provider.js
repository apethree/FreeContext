import { resolveEvalEndpoint } from "./agent-shared.js";
import { getStagedEditWorkspace } from "../scripts/prepare-workspace.js";
import { callClaudeAgent, callCodexAgent, callScoutWithAgent } from "./native-agent-shared.js";
import { callScoutModel } from "./qwen-scout-shared.js";
import { resolveScoutRuntime } from "./scout-models.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildScoutAgentLabel } from "./provider-labels.js";

export default class EditScoutProvider {
  constructor(config = {}) {
    const inner = config.config ?? config;
    this.mainProvider = inner.mainProvider ?? "codex";
    this.scoutPreset = inner.scoutPreset ?? null;
    this.runtime = resolveScoutRuntime({
      preset: this.scoutPreset,
      scoutModel: inner.scoutModel,
      scoutBaseUrl: inner.scoutBaseUrl,
      scoutApiKey: inner.scoutApiKey,
      scoutApiKeyEnv: inner.scoutApiKeyEnv,
    });
  }

  id() {
    return buildScoutAgentLabel({
      mainProvider: this.mainProvider,
      scoutModel: this.runtime.model,
      useMcp: true,
      taskType: "edit",
    });
  }

  async callApi(prompt, context) {
    const endpoint = resolveEvalEndpoint(context?.vars?.endpoint);
    const workspaceRoot = getStagedEditWorkspace();

    return withEvalTrace(buildEvalTraceOptions({
      prompt,
      context,
      metadata: {
        providerLabel: this.id(),
        tier: "scout",
        providerFamily: this.mainProvider === "anthropic" ? "anthropic" : "openai",
        taskType: "edit",
        scoutModel: this.runtime.model,
        scoutPreset: this.scoutPreset,
      },
    }), (traceSpan) => callScoutWithAgent(prompt, {
      scoutModel: this.runtime.model,
      traceSpan,
      scoutCall: (scoutPrompt, scoutSpan) => {
        return callScoutModel(scoutPrompt, {
          preset: this.scoutPreset,
          model: this.runtime.model,
          baseUrl: this.runtime.baseUrl,
          apiKey: this.runtime.apiKey,
          apiKeyEnv: this.runtime.apiKeyEnv,
          workspaceRoot,
          endpoint,
          tier: "scout-research",
          maxTurns: Number(process.env.FREE_CONTEXT_SCOUT_MAX_TURNS ?? "12"),
          traceSpan: scoutSpan,
        });
      },
      mainCall: (synthesisPrompt, mainSpan) => {
        if (this.mainProvider === "anthropic") {
          return callClaudeAgent(synthesisPrompt, {
            workspaceRoot,
            useMcp: true,
            endpoint,
            tier: "scout",
            traceSpan: mainSpan,
            useExistingSpan: true,
          });
        }

        return callCodexAgent(synthesisPrompt, {
          workspaceRoot,
          useMcp: true,
          endpoint,
          tier: "scout",
          traceSpan: mainSpan,
          useExistingSpan: true,
        });
      },
    }));
  }
}
