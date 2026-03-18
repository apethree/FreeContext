import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.js";
import { buildTargetFilter } from "../providers/provider-labels.js";
import { activeAgentLabels } from "./agent-variant-matrix.js";

loadLocalEnv();
const hasUserTargetFilter = process.argv.includes("--filter-targets");

function activeLabels() {
  const groupIndex = process.argv.indexOf("--group");
  const requestedGroup = groupIndex >= 0 ? process.argv[groupIndex + 1] : "all";
  return activeAgentLabels({ group: requestedGroup });
}

async function run() {
  const labels = activeLabels();
  if (labels.length === 0) {
    throw new Error(
      "No smoke-test providers are configured. Set PROXY_API and PROXY_TOKEN, or set ANTHROPIC_API_KEY and/or OPENAI_API_KEY directly."
    );
  }

  const args = [
    "node",
    "evals/scripts/run-agent-evals.js",
    "--filter-pattern",
    "trace path search to the gateway plugin registry area",
    ...process.argv.slice(2),
  ];

  if (!hasUserTargetFilter) {
    args.splice(4, 0, "--filter-targets", buildTargetFilter(labels));
  }

  const child = spawn(args[0], args.slice(1), {
    env: process.env,
    stdio: "inherit",
  });

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
