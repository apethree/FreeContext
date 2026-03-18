import AnthropicDefaultToolsProvider from "../providers/anthropic-default-tools.js";
import AnthropicFreeContextProvider from "../providers/anthropic-freecontext.js";
import OpenAiDefaultToolsProvider from "../providers/openai-default-tools.js";
import OpenAiFreeContextProvider from "../providers/openai-freecontext.js";
import ScoutProvider from "../providers/scout-provider.js";
import { buildTargetFilter, defaultMainModel, labelToken } from "../providers/provider-labels.js";

const DEFAULT_SCOUT_MODEL = "qwen/qwen3.5-27b";
const STRATEGY_DEFS = {
  base: {
    key: "baseline",
    label: "Baseline",
  },
  freecontext: {
    key: "direct-freecontext",
    label: "Direct FreeContext",
  },
  scout: {
    key: "scout-bridge-freecontext",
    label: "Scout Bridge + FreeContext",
  },
};

function familyEnabled(providerFamily) {
  return providerFamily === "anthropic"
    ? !!process.env.ANTHROPIC_API_KEY
    : !!process.env.OPENAI_API_KEY;
}

function normalizeGroup(group = "all") {
  if (group === "codex") {
    return "openai";
  }
  if (group === "claude") {
    return "anthropic";
  }
  return group;
}

function inGroup(providerFamily, group) {
  const normalized = normalizeGroup(group);
  return normalized === "all" || normalized === providerFamily;
}

function providerDisplayName(providerFamily) {
  return providerFamily === "anthropic" ? "Anthropic" : "OpenAI";
}

function variantMeta({ providerFamily, strategyDef, scoutModel = null }) {
  const mainModel = defaultMainModel(providerFamily);
  const scoutSuffix = scoutModel ? ` | Scout ${scoutModel}` : "";
  return {
    mainModel,
    providerDisplayName: providerDisplayName(providerFamily),
    strategyKey: strategyDef.key,
    strategyLabel: strategyDef.label,
    variantKey: `${providerFamily}-${labelToken(mainModel)}-${strategyDef.key}${scoutModel ? `-${labelToken(scoutModel)}` : ""}`,
    variantDisplayName: `${providerDisplayName(providerFamily)} | ${mainModel} | ${strategyDef.label}${scoutSuffix}`,
  };
}

function baseVariants(providerFamily) {
  if (providerFamily === "anthropic") {
    const base = new AnthropicDefaultToolsProvider();
    const freecontext = new AnthropicFreeContextProvider();
    const scout = new ScoutProvider({
      config: {
        mainProvider: "anthropic",
        scoutModel: DEFAULT_SCOUT_MODEL,
      },
    });
    return [
      {
        label: base.id(),
        providerFamily,
        strategy: STRATEGY_DEFS.base.key,
        strategyLabel: STRATEGY_DEFS.base.label,
        semantic: false,
        ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.base }),
        createProvider: () => new AnthropicDefaultToolsProvider(),
      },
      {
        label: freecontext.id(),
        providerFamily,
        strategy: STRATEGY_DEFS.freecontext.key,
        strategyLabel: STRATEGY_DEFS.freecontext.label,
        semantic: false,
        ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.freecontext }),
        createProvider: () => new AnthropicFreeContextProvider(),
      },
      {
        label: scout.id(),
        providerFamily,
        strategy: STRATEGY_DEFS.scout.key,
        strategyLabel: STRATEGY_DEFS.scout.label,
        semantic: false,
        scoutModel: DEFAULT_SCOUT_MODEL,
        ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.scout, scoutModel: DEFAULT_SCOUT_MODEL }),
        createProvider: () =>
          new ScoutProvider({
            config: {
              mainProvider: "anthropic",
              scoutModel: DEFAULT_SCOUT_MODEL,
            },
          }),
      },
    ];
  }

  const base = new OpenAiDefaultToolsProvider();
  const freecontext = new OpenAiFreeContextProvider();
  const scout = new ScoutProvider({
    config: {
      mainProvider: "codex",
      scoutModel: DEFAULT_SCOUT_MODEL,
    },
  });

  return [
    {
      label: base.id(),
      providerFamily,
      strategy: STRATEGY_DEFS.base.key,
      strategyLabel: STRATEGY_DEFS.base.label,
      semantic: false,
      ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.base }),
      createProvider: () => new OpenAiDefaultToolsProvider(),
    },
    {
      label: freecontext.id(),
      providerFamily,
      strategy: STRATEGY_DEFS.freecontext.key,
      strategyLabel: STRATEGY_DEFS.freecontext.label,
      semantic: false,
      ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.freecontext }),
      createProvider: () => new OpenAiFreeContextProvider(),
    },
    {
      label: scout.id(),
      providerFamily,
      strategy: STRATEGY_DEFS.scout.key,
      strategyLabel: STRATEGY_DEFS.scout.label,
      semantic: false,
      scoutModel: DEFAULT_SCOUT_MODEL,
      ...variantMeta({ providerFamily, strategyDef: STRATEGY_DEFS.scout, scoutModel: DEFAULT_SCOUT_MODEL }),
      createProvider: () =>
        new ScoutProvider({
          config: {
            mainProvider: "codex",
            scoutModel: DEFAULT_SCOUT_MODEL,
          },
        }),
    },
  ];
}

export function listActiveAgentVariants({ group = "all", semantic = false } = {}) {
  return ["anthropic", "openai"]
    .filter((providerFamily) => familyEnabled(providerFamily) && inGroup(providerFamily, group))
    .flatMap((providerFamily) =>
      baseVariants(providerFamily).map((variant) => ({
        ...variant,
        semantic,
      }))
    );
}

export function activeAgentLabels(options = {}) {
  return listActiveAgentVariants(options).map((variant) => variant.label);
}

export function activeAgentTargetFilter(options = {}) {
  return buildTargetFilter(activeAgentLabels(options));
}
