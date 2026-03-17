---
title: Eval Quick Reference
---

# Eval Quick Reference

Use this page as the shortest reference for what each eval runs and what its Promptfoo table means.

## Commands

```bash
npm run eval
npm run eval:tool
npm run eval:agent
npm run eval:edit
npm run eval:agent:smoke
npm run eval:semantic
npm run eval:semantic:smoke
npm run eval:ollama
npm run eval:websearch
npm run eval:websearch:smoke
npm run eval:view -- --no
```

## Tables

### Tool eval table

Run:

```bash
npm run eval:tool
```

File:

`evals/tool-evals.yaml`

What the table means:

- Each row is one MCP tool correctness test
- The provider is always the custom `mcp-client`
- A pass means the MCP server returned the expected structured result for that tool

### Main agent table

Run:

```bash
npm run eval:agent
```

File:

`evals/agent-evals.yaml`

What the table means:

- Each row is one repo question answered by one of four providers
- `anthropic-raw` and `openai-raw` are no-tool baselines
- `anthropic-freecontext` and `openai-freecontext` use real FreeContext MCP calls
- The score difference between raw and `+ FreeContext` is the main non-edit effectiveness signal

### Edit benchmark table

Run:

```bash
npm run eval:edit
```

File:

`evals/edit-evals.yaml`

What the table means:

- Each row is one isolated edit task under `evals/fixtures/`
- Raw rows must answer without tools
- `+ FreeContext` rows must find the exact file and exact current line using real MCP calls
- This table measures whether FreeContext improves edit precision

### Agent smoke table

Run:

```bash
npm run eval:agent:smoke
```

File:

`evals/agent-smoke.yaml`

What the table means:

- Each row is a trivial provider connectivity check
- This is only a smoke test for provider wiring
- It is not a FreeContext effectiveness benchmark

### Semantic table

Run full suite (5 tests):

```bash
npm run eval:semantic
```

Run smoke test (2 tests, semantic + hybrid):

```bash
npm run eval:semantic:smoke
```

File:

`evals/semantic-tool-evals.yaml`

Tests:

| # | Description | Mode | Expected symbol |
|---|---|---|---|
| 1 | serialised async write operations | semantic | `enqueueWrite` / `_upsertSymbols` |
| 2 | merge ranked result lists | semantic | `reciprocalRankFusion` |
| 3 | nearest neighbour lookup using embeddings | semantic | `vectorSearch` / `searchSymbols` |
| 4 | graph edges between source symbols | hybrid | `EdgeExtractor` |
| 5 | storage abstraction interface (scoped to `src/storage/`) | semantic | `IndexStorage` |

The smoke test runs tests 1 and 4 — covers both modes with the fastest turnaround.

What the table means:

- Each row is one semantic or hybrid MCP query
- Queries deliberately avoid exact symbol names — they only pass when `--embed` is active
- A pass means semantic retrieval found the expected repo concept, not just a keyword match
- By default reuses `.free-context/db`; set `FREE_CONTEXT_SEMANTIC_REBUILD=1` to force reindex

### Ollama table

Run:

```bash
npm run eval:ollama
```

File:

`evals/ollama-evals.yaml`

What the table means:

- Each row compares `ollama-raw` against `ollama-freecontext`
- This is the local scout-model benchmark
- It measures whether the local model improves when given real MCP tools

## Viewing results

Start the UI:

```bash
npm run eval:view -- --no
```

Then open [http://localhost:15500](http://localhost:15500).

For terminal summaries of a saved run:

```bash
npm run eval:report -- evals/.promptfoo/<file>.json
```
