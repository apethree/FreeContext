import { resolveEvalEndpoint } from "./agent-shared.js";
import { getStagedAgentWorkspace } from "../scripts/prepare-workspace.js";
import { callClaudeAgent, callCodexAgent, callScoutWithAgent } from "./native-agent-shared.js";
import { callScoutModel } from "./qwen-scout-shared.js";
import { resolveScoutRuntime } from "./scout-models.js";
import { buildEvalTraceOptions, withEvalTrace } from "./braintrust-shared.js";
import { buildScoutAgentLabel } from "./provider-labels.js";

export default class ScoutProvider {
  constructor(config = {}) {
    const inner = config.config ?? config;
    this.mainProvider = inner.mainProvider ?? "codex";
    this.useMcp = inner.useMcp ?? true;
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
      useMcp: this.useMcp,
    });
  }

  async callApi(prompt, context) {
    const retrievalMode = context?.vars?.retrievalMode === "embedding" || context?.vars?.retrievalMode === "hybrid"
      ? context.vars.retrievalMode
      : context?.vars?.semantic === true
        ? "embedding"
        : "fulltext";
    const semantic = retrievalMode !== "fulltext";
    const endpoint = resolveEvalEndpoint(context?.vars?.endpoint);
    const workspaceRoot = getStagedAgentWorkspace();

    return withEvalTrace(buildEvalTraceOptions({
      prompt,
      context,
      metadata: {
        providerLabel: this.id(),
        tier: this.useMcp ? "scout" : "scout-base",
        providerFamily: this.mainProvider === "anthropic" ? "anthropic" : "openai",
        taskType: "agent",
        scoutModel: this.runtime.model,
        scoutPreset: this.scoutPreset,
      },
    }), (traceSpan) => callScoutWithAgent(prompt, {
      scoutModel: this.runtime.model,
      semantic,
      traceSpan,
      scoutCall: (scoutPrompt, scoutSpan) => {
        return callScoutModel(scoutPrompt, {
          preset: this.scoutPreset,
          model: this.runtime.model,
          baseUrl: this.runtime.baseUrl,
          apiKey: this.runtime.apiKey,
          apiKeyEnv: this.runtime.apiKeyEnv,
          workspaceRoot,
          semantic,
          retrievalMode,
          useMcp: this.useMcp,
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
            useMcp: this.useMcp,
            semantic,
            retrievalMode,
            endpoint,
            tier: this.useMcp ? "scout" : "scout-base",
            traceSpan: mainSpan,
            useExistingSpan: true,
          });
        }

        return callCodexAgent(synthesisPrompt, {
          workspaceRoot,
          useMcp: this.useMcp,
          semantic,
          retrievalMode,
          endpoint,
          tier: this.useMcp ? "scout" : "scout-base",
          traceSpan: mainSpan,
          useExistingSpan: true,
        });
      },
      useMcp: this.useMcp,
      tier: this.useMcp ? "scout" : "scout-base",
    }));
  }
}
