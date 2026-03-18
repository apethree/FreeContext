import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.js";
import { buildScoutAgentLabel, buildTargetFilter } from "../providers/provider-labels.js";

loadLocalEnv();

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function passthroughArgs() {
  const consumed = new Set(["--group", "--scout"]);
  return process.argv.slice(2).filter((arg, index, args) => {
    if (consumed.has(arg)) {
      return false;
    }
    if (index > 0 && consumed.has(args[index - 1])) {
      return false;
    }
    return true;
  });
}

function labelFor(group, scout) {
  const presetByAlias = {
    qwen27b: "qwen-27b",
    "qwen-27b": "qwen-27b",
    "minimax2.5": "minimax-2.5",
    "minimax-2.5": "minimax-2.5",
    "stepfun3.5flash": "stepfun-3.5-flash",
    "stepfun-3.5-flash": "stepfun-3.5-flash",
    "grok4.1fast": "grok-4.1-fast",
    "grok-4.1-fast": "grok-4.1-fast",
    nemotronsuper: "nemotron-super",
    "nemotron-super": "nemotron-super",
    "local-llama": "local-llama",
    localllama: "local-llama",
  };
  const scoutPreset = presetByAlias[scout] ?? scout;
  if (group === "anthropic") {
    return buildScoutAgentLabel({ mainProvider: "anthropic", scoutPreset, useMcp: true });
  }
  if (group === "openai") {
    return buildScoutAgentLabel({ mainProvider: "openai", scoutPreset, useMcp: true });
  }
  throw new Error(`Unsupported scout smoke group: ${group}`);
}

async function run() {
  const group = readArg("--group", "anthropic");
  const scout = readArg("--scout", "qwen27b");
  const label = labelFor(group, scout);

  const child = spawn(
    "node",
    [
      "evals/scripts/run-agent-scout-matrix.js",
      "--group",
      group,
      "--filter-pattern",
      "trace path search to the gateway plugin registry area",
      "--filter-targets",
      buildTargetFilter([label]),
      ...passthroughArgs(),
    ],
    {
      env: process.env,
      stdio: "inherit",
    }
  );

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });

  process.exit(exitCode);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
