#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { CodeIntelEngine } from "../core/engine.js";

const program = new Command();

program
  .name("code-intel")
  .description("TypeScript-native code intelligence engine")
  .version("0.1.0");

program
  .command("index")
  .description("Index a codebase")
  .argument("[path]", "Path to codebase root", ".")
  .option("--repo-id <id>", "Repository ID")
  .action(async (path: string, opts: { repoId?: string }) => {
    const rootPath = resolve(path);
    console.log(`Indexing ${rootPath}...`);
    const engine = new CodeIntelEngine({
      rootPath,
      repoId: opts.repoId,
    });
    const result = await engine.index();
    console.log(
      `Indexed ${result.filesIndexed} files, ${result.symbolsIndexed} symbols`
    );
  });

program
  .command("search")
  .description("Search indexed symbols")
  .argument("<query>", "Search query")
  .option("--path <path>", "Path to codebase root", ".")
  .option("--limit <n>", "Max results", "20")
  .action(
    async (
      query: string,
      opts: { path: string; limit: string }
    ) => {
      const rootPath = resolve(opts.path);
      const engine = new CodeIntelEngine({ rootPath });
      // Index first (in-memory only for now)
      await engine.index();
      const results = await engine.searchSymbols(query, parseInt(opts.limit, 10));
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }
      for (const sym of results) {
        console.log(
          `${sym.symbolKind.padEnd(12)} ${sym.symbolName.padEnd(30)} ${sym.filePath}:${sym.startLine}`
        );
      }
    }
  );

program.parse();
