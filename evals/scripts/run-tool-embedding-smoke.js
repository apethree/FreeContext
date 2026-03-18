import { runEmbedToolSuite } from "./run-embed-tool-suite.js";

await runEmbedToolSuite({
  title: "Embedding retrieval smoke",
  summary: "one embedding retrieval case against the embed-enabled server",
  configPath: "evals/tool-embedding-evals.yaml",
  filterPattern: "plugin routing through the gateway registry",
  successMessage: "Embedding retrieval smoke passed. Run full suite with: npm run eval:tool:embedding",
});
