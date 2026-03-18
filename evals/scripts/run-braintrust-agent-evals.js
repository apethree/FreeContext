import { runBraintrustAgentEval } from "./braintrust-agent-runner.js";

try {
  await runBraintrustAgentEval({
    configPath: "evals/agent-evals.yaml",
    semantic: false,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
