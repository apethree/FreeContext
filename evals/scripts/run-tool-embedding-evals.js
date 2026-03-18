import { runEmbedToolSuite } from "./run-embed-tool-suite.js";

await runEmbedToolSuite({
  title: "Embedding retrieval tool suite",
  summary: "deterministic embedding-only retrieval checks against the embed-enabled server",
  configPath: "evals/tool-embedding-evals.yaml",
  successMessage: "Embedding retrieval suite passed.",
});
