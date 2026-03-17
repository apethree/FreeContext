---
title: Evals
---

# Evals

FreeContext ships a repo-local Promptfoo harness for evaluating MCP tool correctness and agent answer quality.

## What it runs

- `evals/tool-evals.yaml` checks the 10 MCP tools directly with deterministic assertions
- `evals/agent-evals.yaml` runs a multi-question repo benchmark across four rows: `Anthropic raw`, `OpenAI raw`, `Anthropic + FreeContext`, and `OpenAI + FreeContext`
- `evals/agent-smoke.yaml` validates that configured providers can answer a trivial no-MCP prompt correctly
- `evals/promptfooconfig.yaml` records both suites in one place for Promptfoo config discovery, while `npm run eval` orchestrates the actual two-step run and does not execute that imported config directly

Tool evals and tool-enabled agent evals start a local FreeContext MCP server automatically through the wrapper scripts unless an override endpoint is provided.

The agent suite does not rely on Promptfoo's generic provider-level MCP wiring. Instead, it uses custom JS providers in `evals/providers/` that:

- call Anthropic or OpenAI directly
- run the MCP tool loop explicitly
- feed tool results back to the model
- require a final prose answer before the eval is scored
- attach per-row token usage and tool telemetry to the saved Promptfoo JSON so runs can be summarized after the fact
- retry transient provider failures with exponential backoff so benchmark results are less sensitive to short-lived network or rate-limit blips

## Prerequisites

- Node 20+
- `npm install`
- At least one provider configured for agent evals if you want to run `npm run eval:agent`

Tool evals do not require an LLM API key.

## Environment variables

### MCP endpoint override

Use an existing server instead of the managed local server:

```bash
export FREE_CONTEXT_EVAL_MCP_ENDPOINT=http://127.0.0.1:3100/mcp
```

`MCP_SERVER_URL` is also accepted.

### Anthropic

```bash
export ANTHROPIC_API_KEY=...
```

### OpenAI

```bash
export OPENAI_API_KEY=...
```

### OpenAI-compatible

```bash
export OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:1234/v1
export OPENAI_COMPATIBLE_MODEL=my-model
export OPENAI_COMPATIBLE_API_KEY=...
```

`OPENAI_COMPATIBLE_API_KEY` is optional if your endpoint does not require authentication.

### OpenRouter

```bash
export OPENROUTER_API_KEY=...
```

### Generic proxy

```bash
export PROXY_BASE_URL=https://proxy.example.com
export PROXY_API_KEY=...
```

Use `PROXY_*` when Anthropic- or OpenAI-style eval calls should route through a shared proxy endpoint instead of the direct provider API.

### Ollama local scout

The local Ollama eval path uses Ollama's native `/api/chat` API, not the OpenAI-compatible shim, because native tool calling is more reliable for local Qwen models.

Defaults:

```bash
export OLLAMA_MODEL=qwen3.5:9b
export OLLAMA_API_URL=http://127.0.0.1:11434/api/chat
```

Recommended local models for this repo:

- `qwen3.5:9b` for the local scout / agent rows
- `qwen3-embedding:8b` if you want a local Ollama embedding model available on the machine

## Commands

## Recommended order

Run the suites in this order:

1. `npm run eval:tool`
2. `npm run eval:semantic:smoke`
3. `npm run eval:edit`
4. `npm run eval:agent:smoke`
5. `npm run eval:agent`
6. `npm run eval:ollama` if you specifically want local scout-model comparisons

Use `eval:edit` first if your main question is whether FreeContext reduced token usage. It is the cleanest raw-vs-`+ FreeContext` benchmark in the repo right now.

Run both suites:

```bash
npm run eval
```

If no LLM provider credentials are configured, this runs the tool suite and skips the agent suite.

Run tool evals only:

```bash
npm run eval:tool
```

Run the main effectiveness eval:

```bash
npm run eval:agent
```

This writes a Promptfoo run that is easy to compare visually across:

- `anthropic-raw`
- `openai-raw`
- `anthropic-freecontext`
- `openai-freecontext`

Each row is evaluated across multiple real repo questions, not a single prompt.
The suite runs serially (`maxConcurrency: 1`) because the longer tracing prompts are otherwise dominated by provider TPM limits instead of retrieval quality.

The current agent matrix includes:

- `anthropic-raw`
- `anthropic-freecontext`
- `openai-raw`
- `openai-freecontext`
- `openrouter-qwen-raw`
- `openrouter-qwen-freecontext`
- `openrouter-minimax-raw`
- `openrouter-minimax-freecontext`
- `openrouter-nemotron-raw`
- `openrouter-nemotron-freecontext`
- `openrouter-step-raw`
- `openrouter-step-freecontext`
- `openai-freecontext-fulltext`

`openai-freecontext-fulltext` is the no-embedding FreeContext baseline. It measures the indexed tool layer without semantic embeddings.

Run the isolated real-world edit benchmark:

```bash
npm run eval:edit
```

This uses only real MCP calls against a fresh isolated index built from the repository and scores:

- `anthropic-raw`
- `openai-raw`
- `anthropic-freecontext`
- `openai-freecontext`

The `+ FreeContext` rows use a real local MCP server and real tool calls only. They do not simulate tool output in plain text.

Run a provider-only smoke test with no MCP tools:

```bash
npm run eval:agent:smoke
```

Run the semantic smoke test (2 tests, ~2–3 min including server startup):

```bash
npm run eval:semantic:smoke
```

Covers one `semantic` query and one `hybrid` query — use this to verify the embed server and DB are wired correctly before running the full suite.

Run the local Ollama scout benchmark:

```bash
npm run eval:ollama
```

This starts a managed local FreeContext MCP server automatically and runs:

- `ollama-raw`
- `ollama-freecontext`

The current local scout benchmark uses `qwen3.5:9b` by default.

Open the Promptfoo UI:

```bash
npm run eval:view
```

To inspect a specific saved run, first write one to a JSON file:

```bash
npm run eval:agent:smoke -- -o evals/.promptfoo/agent-smoke.json
```

Then start the viewer:

```bash
npm run eval:view -- --no
```

Promptfoo serves the UI at [http://localhost:15500](http://localhost:15500) by default. The latest run appears automatically in the dashboard.

To print a compact per-row metrics summary from a saved JSON run:

```bash
npm run eval:report -- evals/.promptfoo/edit-real-world-full.json
```

This shows, for each row:

- pass or fail
- Promptfoo latency
- prompt, completion, and total tokens
- tool count and tool names used
- tool loop iterations
- model and tool latency totals
- provider model and MCP endpoint

If you want to check whether FreeContext reduced token usage, save the run to JSON and then report it:

```bash
npm run eval:edit -- --no-table -o evals/.promptfoo/edit.json
npm run eval:agent -- --no-table -o evals/.promptfoo/agent.json
npm run eval:report -- evals/.promptfoo/edit.json
npm run eval:report -- evals/.promptfoo/agent.json
```

For visual comparison, open the Promptfoo UI:

```bash
npm run eval:view -- --no
```

The other quick reference is:
- [docs/reference/eval-quick-reference.md](/Users/narya/github/FreeContext/docs/reference/eval-quick-reference.md)

## Managed server behavior

When no endpoint override is set, the eval wrappers:

- builds `dist/` first if needed
- starts `free-context serve .`
- binds to `127.0.0.1:3214`
- uses LanceDB storage under `evals/.promptfoo/free-context-db`
- removes any previous contents of `evals/.promptfoo/free-context-db` before starting the managed server for tool and main agent runs
- waits for `/health` before starting evals, with a 3 minute default startup timeout for cold indexes
- stops the server after the suite finishes

`evals/edit-evals.yaml` uses a separate isolated MCP server on `127.0.0.1:3212` with its own LanceDB storage under `evals/.promptfoo/edit-free-context-db` so edit tasks never reuse the main eval index.

`evals/semantic-tool-evals.yaml` uses a dedicated semantic MCP server on `127.0.0.1:3213`, but it now reuses the repo's main LanceDB storage at `.free-context/db` by default instead of building a separate eval-only DB. That keeps semantic evals aligned with the index you already use locally.

Semantic eval startup supports two embedding modes:

- local default: managed server starts with `--embed` and uses local Ollama
- remote endpoint: if `FREE_CONTEXT_EMBED_BASE_URL` is set, the managed server starts with `--embedder openai_compatible --embedding-base-url <value>`

**Reusing your already-running server**

If you already have a FreeContext server running with `--embed` (e.g. on port 3211), point the semantic eval at it directly to skip the spawn-and-wait:

```bash
export FREE_CONTEXT_SEMANTIC_MCP_ENDPOINT=http://127.0.0.1:3211/mcp
npm run eval:semantic:smoke
```

The hook will skip spawning a second server and connect to yours. Do not set this if your running server was started *without* `--embed` — semantic queries will silently return no results.

To force the managed semantic server to use a remote OpenAI-compatible embedding endpoint:

```bash
export FREE_CONTEXT_EMBED_BASE_URL=http://192.168.1.117:8002/v1
npm run eval:semantic:smoke
```

To force a fresh semantic rebuild of the repo DB:

```bash
export FREE_CONTEXT_SEMANTIC_REBUILD=1
```

If you want the old isolated semantic eval DB behavior, opt in explicitly:

```bash
export FREE_CONTEXT_SEMANTIC_ISOLATED_DB=1
```

That uses `evals/.promptfoo/semantic-free-context-db` instead.

## Current agent benchmark questions

`evals/agent-evals.yaml` currently checks:

- index-to-storage write path tracing
- config loading and CLI merge behavior before MCP startup
- semantic/hybrid embedding flow
- repo-wide edge fallback resolution
- MCP path-search request flow

## Output and cache

Promptfoo output is written to:

```text
evals/.promptfoo/results.json
```

When you run `npm run eval`, `npm run eval:tool`, or `npm run eval:agent`, Promptfoo still writes its normal eval artifacts, but the managed server state, logs, and LanceDB eval data live under `evals/.promptfoo/`.

## Web search benchmark

`evals/web-search-evals.yaml` is a standalone benchmark that compares web search strategies on a combined coding + internet-lookup problem. It is **not** imported by the main promptfooconfig and must be run separately.

### Providers

| Label | Strategy | Notes |
|---|---|---|
| `1-claude-native-web` | Anthropic native `web_search` beta tool | Server injects full page content — expensive (~80–90k tokens) |
| `2-claude-gemini-mcp` | Claude + Gemini search MCP via local proxy | Requires proxy at `localhost:8317` |
| `3-claude-opencode-exa` | Claude + Exa `/answer` REST (direct, no subprocess) | Requires `EXA_API_KEY`. Multi-call — Claude searches until satisfied |
| `4-claude-context7` | Claude + Context7 doc search MCP | Documentation-only searches |
| `5-claude-scout-agent` | Claude + OpenRouter scout agent | Requires `OPENROUTER_API_KEY` |
| `6a-openrouter-minimax-exa` | MiniMax M2.5:free:online | `:online` suffix — web baked into model slug |
| `6b-openrouter-stepfun-exa` | StepFun 3.5:free:online | `:online` suffix |
| `6c-openrouter-nemotron-exa` | Nemotron 120B:free + Exa plugin | Explicit plugin config — most reliable of the free set |
| `7-openrouter-openai-online` | GPT-4o-mini:online | `:online` suffix via OpenRouter |
| `8-openrouter-qwen-online` | Qwen 3.5 27B:online | `:online` suffix via OpenRouter |

### Environment variables

```bash
ANTHROPIC_API_KEY=...
OPENROUTER_API_KEY=...
EXA_API_KEY=...          # required for provider 3
PROXY_BASE_URL=...       # optional shared proxy for Anthropic/OpenAI-style calls
PROXY_API_KEY=...        # optional shared proxy bearer token
```

All keys are read from `.env.local` at the repo root (falls back to shell env). The runner scripts validate required keys before starting and exit early with a clear message if any are missing.

### Commands

Run the full benchmark (all configured providers):

```bash
npm run eval:websearch
```

Run the smoke test (5 providers × 1 test, ~2–3 min):

```bash
npm run eval:websearch:smoke
```

The smoke test covers: `1-claude-native-web`, `3-claude-opencode-exa`, `6a minimax`, `6b stepfun`, `6c nemotron`, `7-openai`. Use it to verify everything is wired up before committing to a full run.

View results after any run:

```bash
npx promptfoo view
```

Results are written to `evals/.promptfoo/web-search-results.json` (full) and `evals/.promptfoo/web-search-smoke.json` (smoke).

### Exa answer cache

Provider 3 calls the Exa `/answer` API once per tool invocation. Because Claude may make several calls per test, and smoke tests are run repeatedly during development, results are cached to avoid redundant API charges.

Cache file: `evals/.promptfoo/exa-answer-cache.json`

- Keyed by SHA-256 of the query string (first 16 hex chars)
- Persists across runs — survives process restarts
- No TTL — the cache is long-lived by design (npm version data changes slowly)
- Each cache lookup logs `[exa-cache] HIT` or `MISS` to stderr

To force fresh Exa results (e.g. after a package release), delete the cache file:

```bash
rm evals/.promptfoo/exa-answer-cache.json
```

### Web search activation modes

OpenRouter providers use one of two modes, auto-detected by the provider:

- **`:online` suffix** — web search baked into the model slug (`minimax/minimax-m2.5:free:online`). No plugin config sent. The model receives injected results without emitting tool-call XML.
- **Explicit plugin config** — `plugins: [{id: "web", engine: "exa"}]` sent in the request body. Used for Nemotron, which handles the plugin correctly without leaking tool syntax.

The `:online` approach produces cleaner output for models like MiniMax and StepFun that otherwise expose their internal tool-call format (`<minimax:tool_call>`, `<search>`) in the response text.

## Debug-only guardrail

By default, the MCP-enabled provider rows must stop on their own. That is the correct benchmark behavior.

If you need to debug a provider that gets stuck in a tool loop, you can opt into a harness-level forced final answer:

```bash
export FREE_CONTEXT_EVAL_FORCE_FINAL_ANSWER=1
export FREE_CONTEXT_EVAL_FINAL_ANSWER_ROUND_LIMIT=4
```

This is for debugging only and should not be enabled for the primary effectiveness run.
