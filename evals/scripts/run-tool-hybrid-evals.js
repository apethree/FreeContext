import { runEmbedToolSuite } from "./run-embed-tool-suite.js";

await runEmbedToolSuite({
  title: "Hybrid retrieval tool suite",
  summary: "deterministic hybrid retrieval checks against the embed-enabled server",
  configPath: "evals/tool-hybrid-evals.yaml",
  successMessage: "Hybrid retrieval suite passed.",
});
