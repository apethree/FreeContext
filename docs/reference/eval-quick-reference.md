---
title: Eval Quick Reference
---

# Eval Quick Reference

## Commands

```bash
npm run eval:tool
npm run eval:ui
npm run eval:agent
npm run eval:braintrust:agent
npm run eval:agent:scouts
npm run eval:agent:scouts:smoke -- --group anthropic --scout qwen27b
npm run eval:agent:embedding
npm run eval:agent:embedding:smoke
npm run eval:agent:hybrid
npm run eval:agent:hybrid:smoke
npm run eval:braintrust:agent:embedding
npm run eval:braintrust:agent:hybrid
npm run eval:edit
npm run eval:agent:smoke
npm run eval:edit:smoke
npm run eval:tool:fulltext
npm run eval:tool:fulltext:smoke
npm run eval:tool:embedding
npm run eval:tool:embedding:smoke
npm run eval:tool:hybrid
npm run eval:tool:hybrid:smoke
npm run eval:tool:embed:health
npm run eval:view -- --no
```

## Common reruns

Row labels are model-derived. By default, they look like:

- `anthropic-claude-haiku-4-5-20251001-...`
- `openai-gpt-5-codex-mini-...`

Use the right runner:

- `npm run eval:agent:smoke` is a preset wrapper for one default smoke question. It already adds its own `--filter-pattern` and `--filter-targets`.
- `npm run eval:agent` is the right runner when you want exact row control with your own `--filter-targets`.
- Do not add your own `--filter-targets` to `eval:agent:smoke` unless you are intentionally overriding the wrapper behavior.
- The active runners pre-filter provider blocks into a temporary Promptfoo config, so exact `--filter-targets` works for agent, agent-embedding, agent-hybrid, scout-matrix, and edit suites even with repeated custom JS provider files.

Rerun one smoke row:

```bash
npm run eval:agent -- --group anthropic --filter-pattern 'trace path search to the gateway plugin registry area' --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools\+freecontext$'
```

Rerun one row on one main-agent question:

```bash
npm run eval:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools\+freecontext$' --filter-pattern 'trace path search to the gateway plugin registry area'
```

Run exactly one OpenAI base row:

```bash
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'
```

Run the same row in a Braintrust-native experiment:

```bash
npm run eval:braintrust:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'
```

Run all tests for one provider row:

```bash
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'
```

Example Anthropic:

```bash
npm run eval:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools$'
```

Run all tests for all base providers:

```bash
npm run eval:agent -- --filter-targets 'default-tools$'
```

Run exactly one OpenAI base row on the default smoke question:

```bash
npm run eval:agent -- --group openai --filter-pattern 'trace path search to the gateway plugin registry area' --filter-targets '^openai-gpt-5-codex-mini-default-tools$'
```

Run the preset smoke bundle for the whole OpenAI group:

```bash
npm run eval:agent:smoke -- --group openai
```

Run exactly one scout row:

```bash
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools\+freecontext$'
```

Run exactly one scout row on the default smoke question:

```bash
npm run eval:agent -- --group openai --filter-pattern 'trace path search to the gateway plugin registry area' --filter-targets '^openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools\+freecontext$'
```

Run one Braintrust-native embedding row:

```bash
npm run eval:braintrust:agent:embedding -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools\+freecontext$'
```

## What each table means

### Tool table

- command: `npm run eval:tool`
- file: `evals/tool-evals.yaml`
- meaning: one row per deterministic MCP tool correctness check across the standard tool set

### Fulltext retrieval table

- command: `npm run eval:tool:fulltext`
- file: `evals/tool-fulltext-evals.yaml`
- meaning: deterministic fulltext-only retrieval checks

### Fulltext retrieval smoke

- command: `npm run eval:tool:fulltext:smoke`
- file: `evals/tool-fulltext-evals.yaml`
- meaning: one fulltext-only retrieval case

### Embedding retrieval table

- command: `npm run eval:tool:embedding`
- file: `evals/tool-embedding-evals.yaml`
- meaning: deterministic embedding-only retrieval checks against an embed-enabled server

### Embedding retrieval smoke

- command: `npm run eval:tool:embedding:smoke`
- file: `evals/tool-embedding-evals.yaml`
- meaning: one embedding-only retrieval case

### Hybrid retrieval table

- command: `npm run eval:tool:hybrid`
- file: `evals/tool-hybrid-evals.yaml`
- meaning: deterministic hybrid retrieval checks against an embed-enabled server

### Hybrid retrieval smoke

- command: `npm run eval:tool:hybrid:smoke`
- file: `evals/tool-hybrid-evals.yaml`
- meaning: one hybrid retrieval case

### Eval control UI

- command: `npm run eval:ui`
- file: `evals/scripts/run-eval-control-ui.js`
- meaning: local control UI for provider routing, scout routing, clickable row-matrix launch, and recent run logs

Use the row matrix in the UI when you want:

- one exact provider row
- both base rows together
- one provider's full three-row matrix
- scout rows without writing a regex by hand
- a quick reset back to env-loaded proxy URLs, tokens, and direct keys via `Load env defaults`

The settings panel is also row-based now:

- Anthropic row
- OpenAI row
- scout routing row

The UI is split into two tabs:

- `Routing`
- `Run eval`

### Main agent table

- command: `npm run eval:agent`
- file: `evals/agent-evals.yaml`
- meaning: one row per question per benchmark tier

Tiers:

- `anthropic-<model>-default-tools` / `openai-<model>-default-tools`: native coding-agent tools only
- `anthropic-<model>-default-tools+freecontext` / `openai-<model>-default-tools+freecontext`: native coding-agent tools plus FreeContext MCP
- `anthropic-<model>-scout-<scout-model>-default-tools+freecontext`: read-only scout discovery first, then a final Anthropic coding agent, with both phases retaining their own tools plus FreeContext MCP
- `openai-<model>-scout-<scout-model>-default-tools+freecontext`: the same scout-bridge tier on the OpenAI path

### Braintrust agent experiment table

- command: `npm run eval:braintrust:agent`
- script: `evals/scripts/run-braintrust-agent-evals.js`
- meaning: Braintrust-native side-by-side experiment table for the same three active strategies

Each experiment row includes:

- deterministic scores: `FinalAnswerStrictPass`, `FinalAnswerStrictFraction`
- qualitative scores: `FinalAnswerCorrectness`, `FinalAnswerCompleteness`
- metadata columns for provider, strategy, semantic flag, workspace, endpoint, token usage, cost, and scout/main splits

These scores apply to the final row output, not to scout and main separately.
Scout-vs-main analysis lives in the span metadata and the scout/main token-cost split fields.

### Agent embedding table

- command: `npm run eval:agent:embedding`
- file: `evals/agent-embedding-evals.yaml`
- meaning: the same tiers as the main agent table, but with embedding retrieval emphasized

### Agent hybrid table

- command: `npm run eval:agent:hybrid`
- file: `evals/agent-hybrid-evals.yaml`
- meaning: the same tiers as the main agent table, but with hybrid retrieval emphasized

### Braintrust agent embedding table

- command: `npm run eval:braintrust:agent:embedding`
- script: `evals/scripts/run-braintrust-agent-embedding-evals.js`
- meaning: the same three strategies as the embedding Promptfoo suite, but scored and compared in Braintrust Experiments

### Braintrust agent hybrid table

- command: `npm run eval:braintrust:agent:hybrid`
- script: `evals/scripts/run-braintrust-agent-hybrid-evals.js`
- meaning: the same three strategies as the hybrid Promptfoo suite, but scored and compared in Braintrust Experiments

### Edit table

- command: `npm run eval:edit`
- file: `evals/edit-evals.yaml`
- meaning: the same three tiers, but for isolated exact-edit tasks on staged fixture files

### Sandbox rule

- all agent and edit runs execute inside staged workspaces under `evals/.promptfoo/workspaces/`
- scout rows are read-only during discovery
- final edit-capable agents only modify staged copies, never the live repo
- the fixed fixture source is copied into a disposable staged workspace before each run
- LanceDB files live outside the fixed fixture source

### Embed-enabled health

- command: `npm run eval:tool:embed:health`
- file: `evals/tool-embed-smoke-evals.yaml`
- meaning: quick health check that an embed-enabled MCP server is alive and that `search_code` works in fulltext, embedding, and hybrid modes

### Scout matrix table

- command: `npm run eval:agent:scouts`
- file: `evals/agent-scout-matrix-evals.yaml`
- meaning: compare different scout models feeding the same final Claude or Codex agent

## Proxy defaults

Recommended environment:

```bash
export PROXY_API=http://localhost:8317/v1
export PROXY_TOKEN=...
```

Default eval models:

- Claude: `claude-haiku-4-5-20251001`
- Codex/OpenAI: `gpt-5-codex-mini`
- Scout: `qwen/qwen3.5-27b`

Additional scout presets:

- `minimax/minimax-m2.5`
- `stepfun/step-3.5-flash`
- `x-ai/grok-4.1-fast`
- `nvidia/nemotron-3-super-120b-a12b`
- local or other OpenAI-compatible scouts via `FREE_CONTEXT_LOCAL_SCOUT_*` or `FREE_CONTEXT_OPENAI_COMPAT_SCOUT_*`

Promptfoo result caching is off in all active suites. Provider-side prompt caching stays on, and `eval:report` shows fresh prompt tokens, cache read tokens, cache write tokens, effective input surface, and scout-vs-main token or cost breakdown when the row includes a scout phase.

If `BRAINTRUST_API_KEY` is set, the active providers also emit Braintrust spans for `eval_case`, `scout_phase`, `main_phase`, and each `freecontext_mcp_call`. FreeContext span inputs include the exact MCP args, including `search_code.mode`, and phase spans now also include token or cost fields such as `promptTokens`, `completionTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`, `effectiveInputTokens`, and `estimatedCostUsd`.

Root `eval_case` spans also carry:

- strategy tags like `strategy:direct-freecontext`
- the Promptfoo benchmark target via `expected` when the test defines `metadata.expected`

That is the intended Braintrust scorer path for this repo:

- filter by strategy tags
- use a trace-level scorer such as `Correctness` or `Completeness`
- compare `{{output}}` against `{{expected}}`

The benchmark strategy is:

- `eval:tool`: deterministic MCP correctness
- `eval:agent` / `eval:edit`: Promptfoo execution and smoke workflows
- `eval:braintrust:agent`, `eval:braintrust:agent:embedding`, and `eval:braintrust:agent:hybrid`: primary experiment tables for strategy analysis
- `eval:agent:embedding` / `eval:agent:hybrid`: agent benchmarks with explicit retrieval-mode emphasis
- `eval:tool:embedding` / `eval:tool:hybrid`: retrieval-mode correctness checks

## Reporting

Promptfoo UI:

```bash
npm run eval:view -- --no
```

Terminal summary:

```bash
npm run eval:report -- evals/.promptfoo/<file>.json
npm run eval:report -- evals/.braintrust/<file>.json
```
