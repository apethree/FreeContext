# How to Run Web Search Evals

Compares 8 search strategies across two tasks: a coding+research problem and a live npm lookup.

## Prerequisites

- `ANTHROPIC_API_KEY` for direct Anthropic calls, or `PROXY_BASE_URL` + `PROXY_API_KEY` for proxied Anthropic-style calls
- `OPENROUTER_API_KEY` in your shell or `.env.local` (needed for providers 5–8)
- `EXA_API_KEY` for the Exa-backed rows

## Run

```bash
# Quick smoke test — 3 providers × 1 test (~2–3 min)
npm run eval:websearch:smoke

# Full suite — 9 providers × 2 tests (~15–20 min)
npm run eval:websearch
```

## View Results

```bash
npx promptfoo view
```

Opens a local web UI at `http://localhost:15500` with a comparison table showing pass/fail, token usage, latency, and tool call counts per provider.

Results are also saved to `evals/.promptfoo/web-search-smoke.json` / `web-search-results.json`.

## Providers

| # | Label | Search method |
|---|-------|---------------|
| 1 | `claude-native-web` | Anthropic beta `web_search` tool |
| 2 | `claude-gemini-mcp` | Gemini search MCP (via proxy) |
| 3 | `claude-opencode-exa` | Direct Exa MCP call (no model) |
| 4 | `claude-context7` | Context7 documentation search |
| 5 | `claude-scout-agent` | OpenRouter free model + Exa (as a tool Claude calls) |
| 6a | `openrouter-minimax-exa` | MiniMax M2.5:free + Exa plugin |
| 6b | `openrouter-stepfun-exa` | StepFun 3.5 Flash:free + Exa plugin |
| 6c | `openrouter-nemotron-native` | Nemotron 120B:free + Exa plugin |
| 7 | `openrouter-openai-online` | GPT-4o-mini:online via OpenRouter |
| 8 | `openrouter-qwen-online` | Qwen 3.5 27B:online via OpenRouter |

Providers 1–5 all use `claude-haiku-4-5-20251001`. Override with `ANTHROPIC_WEB_EVAL_MODEL=claude-sonnet-4-6`.

## Run a Subset

```bash
# Single provider
npx promptfoo eval -c evals/web-search-evals.yaml \
  --filter-targets "3-claude-opencode-exa"

# Single test
npx promptfoo eval -c evals/web-search-evals.yaml \
  --filter-pattern "npm releases"

# Combine both
npx promptfoo eval -c evals/web-search-evals.yaml \
  --filter-targets "1-claude-native-web|6c-openrouter-nemotron" \
  --filter-pattern "npm releases"
```

## Metrics to Compare

In the promptfoo UI, look at the **Metadata** column for each run:

| Field | What it tells you |
|-------|-------------------|
| `totalMs` | Wall-clock time for the full provider call |
| `toolCallCount` | How many search tool invocations were made |
| `modelRounds` | Claude ↔ tool round trips |
| `tokenUsage.total` | Total tokens billed |
| `searchProvider` | Which backend did the searching |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `401 Invalid API key` | Ensure either direct provider keys are set, or `PROXY_BASE_URL` and `PROXY_API_KEY` are configured for proxied Anthropic/OpenAI-style calls |
| `402 Insufficient credits` (OpenRouter) | Add credits at openrouter.ai/settings/credits — Exa costs ~$0.012/call |
| `404 No endpoints found` (OpenRouter) | That model doesn't support the chosen web engine; the eval uses `exa` which requires credits |
| `429 rate limit` (Anthropic) | You hit 30k input TPM — the eval runs at `concurrency: 1` to avoid this; wait a minute and retry |
| `429` (OpenRouter free models) | Provider 6 retries automatically with backoff; if persistent, wait 30s and rerun |
