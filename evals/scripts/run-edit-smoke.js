import { spawn } from "node:child_process";
import { buildMainAgentLabel, buildScoutAgentLabel, buildTargetFilter } from "../providers/provider-labels.js";

const args = [
  "node",
  "evals/scripts/run-edit-evals.js",
  "--filter-first-n",
  "1",
  "--filter-targets",
  buildTargetFilter([
    buildMainAgentLabel({ mainProvider: "anthropic", useMcp: false, taskType: "edit" }),
    buildMainAgentLabel({ mainProvider: "anthropic", useMcp: true, taskType: "edit" }),
    buildScoutAgentLabel({ mainProvider: "anthropic", scoutModel: "qwen/qwen3.5-27b", useMcp: true, taskType: "edit" }),
    buildMainAgentLabel({ mainProvider: "openai", useMcp: false, taskType: "edit" }),
    buildMainAgentLabel({ mainProvider: "openai", useMcp: true, taskType: "edit" }),
    buildScoutAgentLabel({ mainProvider: "openai", scoutModel: "qwen/qwen3.5-27b", useMcp: true, taskType: "edit" }),
  ]),
  ...process.argv.slice(2),
];

const child = spawn(args[0], args.slice(1), {
  env: process.env,
  stdio: "inherit",
});

child.once("exit", (code) => process.exit(code ?? 1));
child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
