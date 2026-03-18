import { spawn } from "node:child_process";
import { startManagedServer } from "./start-server.js";
import { stopManagedServer } from "./stop-server.js";
import { loadLocalEnv } from "./load-local-env.js";
import { prepareAgentWorkspace } from "./prepare-workspace.js";
import { buildMainAgentLabel, buildScoutAgentLabel, buildTargetFilter } from "../providers/provider-labels.js";
import { readArgValue, stripArgWithValue, writeFilteredPromptfooConfig } from "./promptfoo-provider-filter.js";

loadLocalEnv();
const rawArgs = process.argv.slice(2);
const hasUserTargetFilter = rawArgs.includes("--filter-targets");

const groupArg = (() => {
  const idx = process.argv.indexOf("--group");
  return idx !== -1 ? process.argv[idx + 1] : (process.env.PROVIDER_GROUP ?? "all");
})();
const passthroughArgs = rawArgs.filter((a, i, arr) =>
  a !== "--group" && arr[i - 1] !== "--group"
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

function activeLabels(group) {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAi = !!process.env.OPENAI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasLocalLlama =
    !!process.env.FREE_CONTEXT_LOCAL_SCOUT_MODEL ||
    !!process.env.FREE_CONTEXT_LOCAL_SCOUT_BASE_URL ||
    !!process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL ||
    !!process.env.FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL;

  const anthropicRows = hasAnthropic
    ? [buildMainAgentLabel({ mainProvider: "anthropic", useMcp: true })]
    : [];
  const openAiRows = hasOpenAi
    ? [buildMainAgentLabel({ mainProvider: "openai", useMcp: true })]
    : [];

  if (hasOpenRouter) {
    if (hasAnthropic) {
      anthropicRows.push(
        buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "qwen-27b", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "minimax-2.5", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "stepfun-3.5-flash", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "grok-4.1-fast", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "nemotron-super", useMcp: true })
      );
    }
    if (hasOpenAi) {
      openAiRows.push(
        buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "qwen-27b", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "minimax-2.5", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "stepfun-3.5-flash", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "grok-4.1-fast", useMcp: true }),
        buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "nemotron-super", useMcp: true })
      );
    }
  }

  if (hasLocalLlama) {
    if (hasAnthropic) {
      anthropicRows.push(buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset: "local-llama", useMcp: true }));
    }
    if (hasOpenAi) {
      openAiRows.push(buildScoutAgentLabel({ mainProvider: "openai", scoutPreset: "local-llama", useMcp: true }));
    }
  }

  if (group === "anthropic") return anthropicRows;
  if (group === "openai") return openAiRows;
  return [...anthropicRows, ...openAiRows];
}

async function run() {
  const labels = activeLabels(groupArg);
  if (labels.length === 0) {
    throw new Error(
      `No scout-matrix providers configured for group "${groupArg}". ` +
      "Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY, plus OPENROUTER_API_KEY and/or FREE_CONTEXT_LOCAL_SCOUT_MODEL."
    );
  }

  const workspaceRoot = await prepareAgentWorkspace();
  await stopManagedServer();
  const state = await startManagedServer({
    workspaceRoot,
    storageDirName: "free-context-db",
  });

  const effectiveFilter = hasUserTargetFilter
    ? readArgValue(rawArgs, "--filter-targets")
    : buildTargetFilter(labels);
  const configPath = writeFilteredPromptfooConfig("evals/agent-scout-matrix-evals.yaml", effectiveFilter);
  const args = [
    "promptfoo",
    "eval",
    "-c",
    configPath,
    ...stripArgWithValue(passthroughArgs, "--filter-targets"),
  ];

  const child = spawn(
    "npx",
    args,
    {
      env: {
        ...process.env,
        FREE_CONTEXT_EVAL_MCP_ENDPOINT: state.endpoint,
        FREE_CONTEXT_EVAL_ROOT: workspaceRoot,
      },
      stdio: "inherit",
    }
  );

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });

  await stopManagedServer();
  process.exit(exitCode);
}

try {
  await run();
} catch (error) {
  await stopManagedServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
