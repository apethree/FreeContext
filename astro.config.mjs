import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  outDir: "./dist-docs",
  integrations: [
    starlight({
      title: "FreeContext",
      description:
        "Host-agnostic TypeScript code intelligence engine with symbol indexing, search, call graphs, and MCP server.",
      sidebar: [
        {
          label: "Architecture",
          items: [
            { label: "Overview", slug: "architecture/overview" },
            { label: "Data Model", slug: "architecture/data-model" },
          ],
        },
        {
          label: "How To",
          items: [
            { label: "Index a Project", slug: "how-to/index-a-project" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "reference/cli" },
            { label: "Config", slug: "reference/config" },
          ],
        },
        {
          label: "Decisions (ADR)",
          items: [
            {
              label: "Tree-sitter over Compiler API",
              slug: "adr/001-tree-sitter-over-compiler-api",
            },
            {
              label: "Memory Storage First",
              slug: "adr/002-memory-storage-first",
            },
            {
              label: "Pin Tree-sitter Runtime",
              slug: "adr/003-pin-tree-sitter-runtime-to-peer-range",
            },
            {
              label: "Swappable Embedders",
              slug: "adr/004-make-embedders-swappable",
            },
          ],
        },
        { label: "Roadmap", slug: "roadmap" },
        { label: "Glossary", slug: "glossary" },
      ],
    }),
  ],
});
