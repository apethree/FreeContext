---
title: Eval Control UI
---

# Eval Control UI

FreeContext includes a local control UI with two tabs:

- `Routing` for base-model and scout setup
- `Run eval` for suite selection, row selection, and recent runs

Start it with:

```bash
npm run eval:ui
```

Open:

```text
http://127.0.0.1:3216
```

Use Promptfoo's result viewer separately at:

```text
http://localhost:15500/
```

## What the UI does

- configure Anthropic base-model routing as `proxy` or `direct`
- configure OpenAI base-model routing as `proxy` or `direct`
- show both base providers at once in row-based settings instead of hiding one behind a tab
- configure scout routing as either:
  - `Remote preset registry`
  - `OpenAI-compatible endpoint`
- keep routing setup in its own tab so day-to-day use can stay focused on `Run eval`
- show the current agent matrix as clickable rows instead of requiring manual regex
- launch any supported eval suite through the existing repo runner scripts
- show retrieval suites under clearer names:
  - `Tool core`
  - `Tool fulltext`
  - `Tool embedding`
  - `Tool hybrid`
  - `Embed-enabled health`
  - `Agent full`
  - `Agent embedding`
  - `Agent hybrid`
- show recent run logs and output file paths
- preserve scroll position while recent runs auto-refresh
- preload saved values first, then env-backed defaults for proxy URLs, tokens, scout keys, and direct-provider fields when available
- show the loaded keys and tokens directly in the form so they can be overridden quickly

The UI does not bypass the existing harness. It still uses the current repo runners for:

- workspace staging
- managed MCP startup and shutdown
- provider and scout row filtering
- Braintrust tracing

## Base model routing

For each base model family:

- `proxy` uses the configured proxy URL and token
- `direct` uses the provider-specific base URL and API key

The base-model section is row-based:

- one row for Anthropic
- one row for OpenAI
- each row shows route, model, endpoint, and token/key together

The UI writes only to a local config file under:

```text
evals/.promptfoo/eval-control-config.json
```

It does not modify `.env.local`.

Use `Load env defaults` when you want to discard the saved UI config and repopulate every field from the current process environment.

## Scout routing

Scout routing supports:

- `Remote preset registry`
- `OpenAI-compatible endpoint`

Use `Remote preset registry` for named scout presets such as `qwen-27b`, `minimax-2.5`, or `nemotron-super`.

Use `OpenAI-compatible endpoint` when you want the scout to call a local or remote server that speaks OpenAI-compatible chat completions, for example:

```text
http://127.0.0.1:11434/v1
```

In this mode, the UI keeps the same scout preset dropdown. The selected preset determines the model id sent to the OpenAI-compatible endpoint. The UI asks for:

- endpoint base URL
- API key or placeholder token

By default, the compatible scout endpoint fields preload the same proxy URL and token used by the current eval runs when those proxy env vars are present.

This is the right mode for Ollama, llama.cpp servers, and similar local scout setups.

## Row selection

The main agent-style suites now use a clickable matrix. You can:

- click one exact row
- click two base rows for a full two-provider base run
- click a full provider matrix with the quick-action buttons
- leave the matrix alone and use the advanced filter input if needed

The UI computes the correct `--filter-targets` regex for you.

Examples:

- only the OpenAI base row
- both base rows across Anthropic and OpenAI
- only scout rows
- one provider's full three-row matrix

## Recommended usage

1. Open `Routing`.
2. Set the Anthropic and OpenAI routing modes.
3. Set scout routing as a remote preset or an OpenAI-compatible endpoint.
4. Save routing.
5. The UI returns to `Run eval`.
6. Choose a suite, click rows, and run the eval.

For tool runs, the intended split is:

- `Tool core` for general MCP correctness
- `Tool fulltext` for fulltext-only retrieval
- `Tool embedding` for embedding-only retrieval checks
- `Tool hybrid` for hybrid retrieval checks
- `Embed-enabled health` for a quick health pass that proves an embed-enabled server is alive

## Notes

- the UI is local-only
- the UI does not store run state in the repo outside `evals/.promptfoo/`
- Promptfoo remains the evaluation engine and result viewer
- older `semantic` suite names are treated as compatibility aliases inside the UI config, but the UI now displays the clearer retrieval names
