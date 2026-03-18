import { spawn } from "node:child_process";

const child = spawn("node", ["evals/scripts/run-braintrust-agent-embedding-evals.js", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

child.once("exit", (code) => process.exit(code ?? 1));
child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
