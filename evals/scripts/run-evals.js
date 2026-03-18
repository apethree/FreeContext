import { spawn } from "node:child_process";
import { loadLocalEnv } from "./load-local-env.js";
import { stopManagedServer } from "./stop-server.js";

loadLocalEnv();

function hasAgentProvider() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY
  );
}

async function runScript(scriptName, extraArgs) {
  const child = spawn("node", [`evals/scripts/${scriptName}`, ...extraArgs], {
    env: process.env,
    stdio: "inherit",
  });

  return new Promise((resolvePromise, rejectPromise) => {
    child.once("exit", (code) => resolvePromise(code ?? 1));
    child.once("error", rejectPromise);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopManagedServer();
    process.exit(1);
  });
}

async function run() {
  const extraArgs = process.argv.slice(2);
  const toolExitCode = await runScript("run-tool-evals.js", extraArgs);
  if (toolExitCode !== 0) {
    process.exit(toolExitCode);
  }

  if (!hasAgentProvider()) {
    process.stdout.write(
      "Skipping agent evals because no provider credentials were configured.\n"
    );
    process.exit(0);
  }

  const agentExitCode = await runScript("run-agent-evals.js", extraArgs);
  process.exit(agentExitCode);
}

try {
  await run();
} catch (error) {
  await stopManagedServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
