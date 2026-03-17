import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const child = spawn(
  "npx",
  ["promptfoo", "eval", "-c", "evals/ollama-evals.yaml", ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: "inherit",
  }
);

child.once("exit", (code) => {
  process.exit(code ?? 1);
});

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
