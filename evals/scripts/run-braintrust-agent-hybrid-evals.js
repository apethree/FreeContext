import { runBraintrustAgentEval } from "./braintrust-agent-runner.js";

try {
  await runBraintrustAgentEval({
    configPath: "evals/agent-hybrid-evals.yaml",
    semantic: true,
    retrievalMode: "hybrid",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
