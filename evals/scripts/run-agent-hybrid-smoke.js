import { spawn } from "node:child_process";

const args = [
  "node",
  "evals/scripts/run-agent-hybrid-evals.js",
  "--filter-first-n",
  "1",
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
