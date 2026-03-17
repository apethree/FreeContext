import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/__tests__/**", "!src/content.config.ts"],
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: [
    "tree-sitter",
    "tree-sitter-typescript",
    "tree-sitter-javascript",
  ],
});
