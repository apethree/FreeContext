import { runEmbedToolSuite } from "./run-embed-tool-suite.js";

await runEmbedToolSuite({
  title: "Hybrid retrieval smoke",
  summary: "one hybrid retrieval case against the embed-enabled server",
  configPath: "evals/tool-hybrid-evals.yaml",
  filterPattern: "plugin routing through the gateway registry",
  successMessage: "Hybrid retrieval smoke passed. Run full suite with: npm run eval:tool:hybrid",
});
