---
title: Evals
---

# Evals

FreeContext keeps two repo-local eval paths under `evals/`:

- Promptfoo for deterministic MCP correctness, smoke workflows, and the local control UI
- Braintrust-native experiment runners for the main strategy-analysis view

The active benchmark is SDK-native. Claude rows use the Claude agent SDK, Codex rows use the Codex SDK, and both run with real coding tools inside an isolated staged workspace.

When `BRAINTRUST_API_KEY` is present, the active providers also emit Braintrust spans for:

- `eval_case`
- `scout_phase`
- `main_phase`
- each `freecontext_mcp_call`
- each non-MCP `tool_call`

FreeContext spans log the exact MCP args. For `search_code`, that includes `mode`, so embedding vs fulltext vs hybrid usage is explicit.
Claude-agent and scout traces also include a compact tool-result preview so Braintrust shows not only the tool call, but a trimmed view of what FreeContext returned.
Root `eval_case` spans now also include strategy tags such as:

- `strategy:baseline`
- `strategy:direct-freecontext`
- `strategy:scout-bridge-freecontext`

and carry the Promptfoo test `expected` payload when the test case defines `metadata.expected` or `vars.expected`.
That makes Braintrust trace-level scorers usable directly against the saved eval traces.
Phase spans now include token and cost fields directly on the span metadata:

- `promptTokens`
- `completionTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `totalTokens`
- `effectiveInputTokens`
- `estimatedCostUsd`

For scout-bridge rows, the root `eval_case` span also carries separate `scout*` and `main*` token and cost fields so phase-level usage is visible without reconstructing it from the child spans.

## Braintrust-native experiments

Use Braintrust as the primary comparison surface for agent strategy analysis.

Commands:

```bash
npm run eval:braintrust:agent
npm run eval:braintrust:agent:embedding
npm run eval:braintrust:agent:hybrid
```

These runners:

- reuse the current staged workspace flow
- reuse the current managed FreeContext MCP startup flow
- reuse the current provider implementations
- load test cases and `expected` targets from the active Promptfoo YAML suites
- write local summary files under `evals/.braintrust/`

Each Braintrust row includes metadata columns such as:

- `providerLabel`
- `providerFamily`
- `providerDisplayName`
- `strategy`
- `strategyLabel`
- `variantKey`
- `variantDisplayName`
- `mainModel`
- `semantic`
- `scoutModel`
- `workspaceRoot`
- `endpoint`
- token and cost fields
- scout/main split fields when applicable

And each row records two score families:

- strict code-based:
  - `FinalAnswerStrictPass`
  - `FinalAnswerStrictFraction`
- qualitative LLM-based:
  - `FinalAnswerCorrectness`
  - `FinalAnswerCompleteness`

Those Braintrust scores are always attached to the final row output, not to the scout phase separately.
Scout and main phases remain visible through span-level token, cost, and tool metadata.

## Braintrust scoring workflow

The active agent and edit suites now populate an `expected` field on the root trace span for benchmark-style tasks.
In Braintrust, the recommended setup is:

- filter traces by `strategy:*` tags
- create a trace-level scorer such as `Correctness` or `Completeness`
- evaluate `{{output}}` against `{{expected}}`

This gives you:

- a stable target answer per task
- a quantitative classification score per strategy
- direct comparison of quality against token and cost metadata already attached to the trace

Braintrust Experiments are therefore the primary table view for strategy comparison. Promptfoo remains in the repo, but is no longer the primary analysis surface.

## Active suites

### `npm run eval:tool`

- config: `evals/tool-evals.yaml`
- purpose: deterministic checks for the 10 current FreeContext MCP tools
- provider requirement: none

### `npm run eval:tool:fulltext`

- config: `evals/tool-fulltext-evals.yaml`
- purpose: deterministic fulltext-only retrieval checks, independent of any agent provider

### `npm run eval:tool:fulltext:smoke`

- config: `evals/tool-fulltext-evals.yaml`
- purpose: one fulltext-only retrieval case

### `npm run eval:ui`

- script: `evals/scripts/run-eval-control-ui.js`
- purpose: local control UI for provider routing, scout routing, clickable row-matrix launch, and recent run logs
- open: `http://127.0.0.1:3216`
- pair with Promptfoo viewer at: `http://localhost:15500/`

The UI is the easiest way to:

- run one exact provider row
- run exactly two base rows together
- run one provider's full three-row matrix
- swap scouts between a remote preset and an OpenAI-compatible local or remote endpoint
- reload the form from the current env defaults when you want to override a saved UI config quickly

The settings area is row-based:

- one row per base provider
- one row for scout routing

That keeps route, model, endpoint, and token visible at the same time.
The UI is also split into:

- `Routing`
- `Run eval`

so routing can be saved once and the normal workflow can stay in the run tab.

Each provider row keeps `proxy` and `direct` settings together, with only the active route fields enabled. Scout routing is split into:

- `Remote preset registry` for named scout presets
- `OpenAI-compatible endpoint` for Ollama, llama.cpp, or another compatible local or remote scout server

### `npm run eval:agent`

- config: `evals/agent-evals.yaml`
- purpose: main non-edit benchmark
- rows: model-derived labels such as
  - `anthropic-claude-haiku-4-5-20251001-default-tools`
  - `anthropic-claude-haiku-4-5-20251001-default-tools+freecontext`
  - `anthropic-claude-haiku-4-5-20251001-scout-qwen-qwen3.5-27b-default-tools+freecontext`
  - `openai-gpt-5-codex-mini-default-tools`
  - `openai-gpt-5-codex-mini-default-tools+freecontext`
  - `openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools+freecontext`

This measures:

- base coding agent with its normal local tools
- the same coding agent plus FreeContext MCP
- a scout-bridge tier where a read-only Qwen 27B scout performs discovery first, then hands evidence to the final coding agent, and both phases retain their normal local tools plus FreeContext MCP

### `npm run eval:braintrust:agent`

- script: `evals/scripts/run-braintrust-agent-evals.js`
- purpose: Braintrust-native non-semantic experiment table for the active 3-tier agent strategy matrix
- local artifact: `evals/.braintrust/braintrust-agent-*.json`

Experiment names are now human-readable and include:

- suite type
- provider family or group
- selected strategy when one row is filtered
- selected case when one case is filtered
- timestamp

Example:

- `Agent Eval | Anthropic | Baseline | claude-haiku-4-5-20251001 | trace path search to the gateway plugin registry area | 2026-03-18 08:08`

Common reruns:

```bash
# one provider family
npm run eval:braintrust:agent -- --group anthropic

# one exact row across all active questions
npm run eval:braintrust:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'

# one exact row on one question
npm run eval:braintrust:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools$' --filter-pattern 'trace path search to the gateway plugin registry area'
```

### `npm run eval:agent:scouts`

- config: `evals/agent-scout-matrix-evals.yaml`
- purpose: compare multiple scout models while keeping the final coding agent fixed

Supported scout presets:

- `qwen-27b`
- `minimax-2.5`
- `stepfun-3.5-flash`
- `grok-4.1-fast`
- `nemotron-super`
- `local-llama`
- `openai-compatible`

OpenRouter-backed scout presets require `OPENROUTER_API_KEY`. The `local-llama` and `openai-compatible` presets target an OpenAI-compatible endpoint and use:

```bash
export FREE_CONTEXT_LOCAL_SCOUT_BASE_URL=http://127.0.0.1:11434/v1
export FREE_CONTEXT_LOCAL_SCOUT_MODEL=llama3.3
export FREE_CONTEXT_LOCAL_SCOUT_API_KEY=ollama
```

You can also use the generic names:

```bash
export FREE_CONTEXT_OPENAI_COMPAT_SCOUT_BASE_URL=http://127.0.0.1:8080/v1
export FREE_CONTEXT_OPENAI_COMPAT_SCOUT_MODEL=your-scout-model
export FREE_CONTEXT_OPENAI_COMPAT_SCOUT_API_KEY=token-or-placeholder
```

Any local scout endpoint must support OpenAI-compatible `/chat/completions` requests with tool calling. A local `llama.cpp` or compatible server will work if it supports that contract.

### `npm run eval:agent:embedding`

- config: `evals/agent-embedding-evals.yaml`
- purpose: embedding-focused benchmark for the active FreeContext-enabled and scout-bridge rows

### `npm run eval:agent:hybrid`

- config: `evals/agent-hybrid-evals.yaml`
- purpose: hybrid-focused benchmark for the active FreeContext-enabled and scout-bridge rows

### `npm run eval:braintrust:agent:embedding`

- script: `evals/scripts/run-braintrust-agent-embedding-evals.js`
- purpose: Braintrust-native embedding experiment table for the active 3-tier agent strategy matrix
- local artifact: `evals/.braintrust/braintrust-agent-embedding-*.json`

### `npm run eval:braintrust:agent:hybrid`

- script: `evals/scripts/run-braintrust-agent-hybrid-evals.js`
- purpose: Braintrust-native hybrid experiment table for the active 3-tier agent strategy matrix
- local artifact: `evals/.braintrust/braintrust-agent-hybrid-*.json`

### `npm run eval:edit`

- config: `evals/edit-evals.yaml`
- purpose: exact edit-task benchmark on staged fixture files

This uses the same six rows as `eval:agent`, but scores exact line-level edit proposals instead of code-intelligence explanations.

The scout rows are read-only during discovery. The final coding agent remains responsible for the edit decision and final response.

### `npm run eval:tool:embedding`

- config: `evals/tool-embedding-evals.yaml`
- purpose: deterministic embedding-only retrieval checks, independent of any agent provider

### `npm run eval:tool:embedding:smoke`

- config: `evals/tool-embedding-evals.yaml`
- purpose: one embedding-only retrieval case

### `npm run eval:tool:hybrid`

- config: `evals/tool-hybrid-evals.yaml`
- purpose: deterministic hybrid retrieval checks, independent of any agent provider

### `npm run eval:tool:hybrid:smoke`

- config: `evals/tool-hybrid-evals.yaml`
- purpose: one hybrid retrieval case

### `npm run eval:tool:embed:health`

- config: `evals/tool-embed-smoke-evals.yaml`
- purpose: embed-enabled MCP health check over `fulltext`, embedding, and `hybrid` search modes

Legacy aliases remain available:

- `npm run eval:semantic` -> `npm run eval:tool:embedding`
- `npm run eval:semantic:smoke` -> `npm run eval:tool:embedding:smoke`
- `npm run eval:tool:embed:smoke` -> `npm run eval:tool:embed:health`
- `npm run eval:agent:semantic` -> `npm run eval:agent:embedding`
- `npm run eval:agent:semantic:smoke` -> `npm run eval:agent:embedding:smoke`
- `npm run eval:braintrust:agent:semantic` -> `npm run eval:braintrust:agent:embedding`

## Smoke commands

Use these before a larger paid run:

```bash
npm run eval:agent:smoke
npm run eval:agent:scouts
npm run eval:agent:scouts:smoke -- --group anthropic --scout qwen27b
npm run eval:agent:embedding:smoke
npm run eval:agent:hybrid:smoke
npm run eval:edit:smoke
npm run eval:tool:fulltext:smoke
npm run eval:tool:embedding:smoke
npm run eval:tool:hybrid:smoke
npm run eval:tool:embed:health
```

Important:

- `npm run eval:agent:smoke` is a wrapper around `eval:agent` that already injects a default smoke question and a default target set for the selected group.
- Use `npm run eval:agent` when you want to supply your own `--filter-targets` or `--filter-pattern`.
- If you mix `eval:agent:smoke` with your own `--filter-targets`, you can end up with zero matched rows because the wrapper has already applied its own target filter.
- The agent, agent-embedding, agent-hybrid, scout-matrix, and edit runners now pre-filter provider blocks into a temporary Promptfoo config before execution. That means exact provider and scout selection works even when Promptfoo does not reliably match repeated custom JS providers by runtime label.
- Exact row selection is now implemented by the repo runners, not by trusting Promptfoo to disambiguate repeated `file://./providers/...` entries on its own.

Common targeted reruns:

```bash
# preset smoke bundle for one group
npm run eval:agent:smoke -- --group anthropic

# one exact row on one main-agent question
npm run eval:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools\+freecontext$' --filter-pattern 'trace path search to the gateway plugin registry area'

# one exact OpenAI base row across all main-agent questions
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'

# all tests for one provider row
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'

# all tests for one Anthropic provider row
npm run eval:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools$'

# all tests for all base providers
npm run eval:agent -- --filter-targets 'default-tools$'

# Braintrust-native run for one exact row
npm run eval:braintrust:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$'

# Braintrust-native run for one exact row on one question
npm run eval:braintrust:agent -- --group anthropic --filter-targets '^anthropic-claude-haiku-4-5-20251001-default-tools$' --filter-pattern 'trace path search to the gateway plugin registry area'

# one exact OpenAI base row on the default smoke question
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-default-tools$' --filter-pattern 'trace path search to the gateway plugin registry area'

# one exact OpenAI scout row
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools\+freecontext$'

# one exact OpenAI scout row on the default smoke question
npm run eval:agent -- --group openai --filter-targets '^openai-gpt-5-codex-mini-scout-qwen-qwen3.5-27b-default-tools\+freecontext$' --filter-pattern 'trace path search to the gateway plugin registry area'
```

## Workspace and server behavior

- main agent, agent-embedding, and agent-hybrid suites stage `evals/workspaces/oneshot-platform-fixture`
- edit suites stage `evals/fixtures/` into a temporary edit workspace
- tool suites start a managed local MCP server automatically unless you override the endpoint
- LanceDB state is kept outside the fixed fixture source under `.free-context/` or `evals/.promptfoo/*-db`

## Sandboxing strategy

The benchmark never runs against the live repository as the agent workspace.

- agent, embedding, and hybrid runs use a staged copy of `evals/workspaces/oneshot-platform-fixture`
- edit runs use a staged copy of `evals/fixtures/`
- the managed FreeContext MCP server points at the staged workspace for that suite
- edit-capable rows may change files only inside the staged workspace
- scout rows are discovery-only and do not edit files
- the fixed fixture source is the reset point; each run rebuilds a disposable staged workspace before agents start

This keeps the benchmark realistic for coding-agent behavior while isolating all file mutations to disposable staged workspaces.

## Test strategy

The eval harness is meant to answer three separate questions:

- tool correctness: do the FreeContext MCP tools return the right repo facts?
- agent lift: does FreeContext improve an already-capable coding agent with normal local tools?
- retrieval lift: does embedding or hybrid retrieval improve the FreeContext-enabled path?

The main benchmark therefore compares:

- `<provider>-<model>-default-tools`
- `<provider>-<model>-default-tools+freecontext`
- `<provider>-<model>-scout-<scout-model>-default-tools+freecontext`

In Braintrust, prefer the clearer metadata columns for analysis:

- `variantDisplayName`
- `strategyLabel`
- `mainModel`
- `scoutModel`
- `retrievalLabel`

The edit benchmark keeps the same sandbox model, but scores exact edit proposals instead of code-intelligence explanations.

Override the MCP endpoint with:

```bash
export FREE_CONTEXT_EVAL_MCP_ENDPOINT=http://127.0.0.1:3100/mcp
```

`MCP_SERVER_URL` is also accepted.

## Cache policy

All active Promptfoo suites keep:

- `evaluateOptions.cache: false`

That disables Promptfoo result reuse across runs.

Provider-side prompt caching stays enabled. Claude and Codex cache behavior is treated as part of the real agent runtime, so the harness reports fresh prompt vs cache-read vs cache-write usage separately instead of trying to disable provider caching.

Scout loops are capped but not hard-failed on turn exhaustion in the current branch. If a scout reaches the configured tool-turn budget, it is forced into a final evidence-summary turn instead of throwing. The default scout turn budget is `12`, overridable with `FREE_CONTEXT_SCOUT_MAX_TURNS`.

## Proxy-backed model setup

The current default eval setup expects a local proxy and derives provider-specific env vars from it.

Recommended shell setup:

```bash
export PROXY_API=http://localhost:8317/v1
export PROXY_TOKEN=...
export BRAINTRUST_API_KEY=...
```

The eval harness automatically maps that to:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`

You can still set provider-specific env vars directly if you prefer.

If `BRAINTRUST_API_KEY` is set, the harness defaults `BRAINTRUST_PROJECT=FreeContext` unless you override it.

Promptfoo rubric grading is also pinned to the same proxy-backed Claude path in the active agent, embedding, hybrid, and edit suites, so the benchmark does not silently fall back to Promptfoo's built-in OpenAI grader default.

Braintrust-native LLM scoring defaults to:

- `BRAINTRUST_GRADER_BASE_URL` / `BRAINTRUST_GRADER_MODEL` when explicitly set
- otherwise a cheap scout-style grader route, preferring the configured scout runtime
- otherwise the proxy-backed route if `PROXY_API` and `PROXY_TOKEN` are available

If no grading route can be resolved, Braintrust-native runs still execute and log strict deterministic scores; the LLM scores are skipped.

## Default test models

Unless overridden, the active benchmark uses:

- Claude: `claude-haiku-4-5-20251001`
- Codex/OpenAI: `gpt-5-codex-mini`
- Scout: `qwen/qwen3.5-27b`

Promptfoo row labels are derived from those configured model IDs. If you change `ANTHROPIC_AGENT_EVAL_MODEL`, `OPENAI_AGENT_EVAL_MODEL`, or the scout preset/model, the visible row names change with them.

## Local summaries

Promptfoo writes under:

- `evals/.promptfoo/`

Braintrust-native runs write local summaries under:

- `evals/.braintrust/`

Both can be inspected with:

```bash
npm run eval:report -- <path-to-json>
```

That Codex default is intentional for the local proxy path: the proxy currently exposes a working mini Codex model on `/v1/responses`, while `gpt-5.4-mini` is not currently available there.

Overrides:

```bash
export ANTHROPIC_AGENT_EVAL_MODEL=claude-haiku-4-5-20251001
export OPENAI_AGENT_EVAL_MODEL=gpt-5-codex-mini
export FREE_CONTEXT_SCOUT_MODEL=qwen/qwen3.5-27b
```

The final Claude and Codex agent rows use the configured proxy-backed provider paths. The Qwen scout path uses OpenRouter for `qwen/qwen3.5-27b`.

## Embedding overrides

Use these when the embed-enabled retrieval server should talk to a remote OpenAI-compatible embedding endpoint:

```bash
export FREE_CONTEXT_EMBED_BASE_URL=http://127.0.0.1:8002/v1
export FREE_CONTEXT_EMBED_MODEL_ID=qwen3-embedding-0.6b
export FREE_CONTEXT_EMBED_DIMENSIONS=1024
```

By default, embedding and hybrid runs reuse `.free-context/db`. Set `FREE_CONTEXT_SEMANTIC_ISOLATED_DB=1` to force an isolated eval-only embedding DB under `evals/.promptfoo/`.

## Recommended order

```bash
npm run eval:tool
npm run eval:tool:fulltext
npm run eval:agent:smoke
npm run eval:edit:smoke
npm run eval:agent
npm run eval:edit
npm run eval:agent:embedding
npm run eval:agent:hybrid
npm run eval:tool:embedding
npm run eval:tool:hybrid
npm run eval:tool:embed:health
```

## Reporting

Promptfoo UI:

```bash
npm run eval:view -- --no
```

Then open [http://localhost:15500](http://localhost:15500).

Terminal summary for a saved run:

```bash
npm run eval:report -- evals/.promptfoo/<file>.json
```

The report includes:

- provider and model
- tier
- retrieval mode
- fresh prompt, completion, cache read, cache write, and total tokens
- effective input surface (`prompt + cacheRead + cacheWrite`)
- cost
- scout-vs-main token and cost totals for scout-bridge rows
- main local coding-tool counts
- main FreeContext MCP counts
- scout local-tool counts
- scout FreeContext MCP counts
- tool names split by main phase vs scout phase
- changed paths
- workspace root and MCP endpoint
